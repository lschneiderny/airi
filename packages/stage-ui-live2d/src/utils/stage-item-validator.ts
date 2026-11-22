import JSZip from 'jszip'

import { decodeZipFileName } from './decode-zip-filename'
import { validateLive2DZip } from './live2d-validator'

/** How a stage item draws: a still image, an animated GIF, or a Live2D model. */
export type StageItemFormat = 'image' | 'gif' | 'live2d-zip'

export type StageItemFileRefusal = 'unsupported-type' | 'too-large' | 'too-many-frames' | 'invalid-live2d' | 'unreadable'

/** What the library stores about an accepted file. Sizes are pixels; a Live2D item's size is its model canvas. */
export interface StageItemFileInfo {
  format: StageItemFormat
  mime: string
  width: number
  height: number
  frames?: number
  /** Canvas size of a Live2D model, which the outfit placement preset maps onto hers. */
  canvas?: { width: number, height: number }
}

export type StageItemFileInspection
  = | { ok: true, info: StageItemFileInfo }
    | { ok: false, reason: StageItemFileRefusal }

/**
 * Import limits. A file at a limit passes; one byte, pixel, or frame over it is refused. GIF frames are decoded on
 * demand when shown, so the frame cap bounds decode work, not memory.
 */
export const stageItemFileLimits = {
  imageBytes: 16 * 1024 * 1024,
  gifBytes: 32 * 1024 * 1024,
  live2dZipBytes: 64 * 1024 * 1024,
  longestSidePx: 4096,
  gifFrames: 1024,
} as const

type SniffedType = 'png' | 'jpeg' | 'gif' | 'zip'

/** Classifies by magic bytes only: a file's name and MIME type come from the user and say nothing reliable. */
function sniffType(head: Uint8Array): SniffedType | undefined {
  const startsWith = (signature: readonly number[]) => signature.every((byte, index) => head[index] === byte)
  if (startsWith([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
    return 'png'
  if (startsWith([0xFF, 0xD8, 0xFF]))
    return 'jpeg'
  // GIF87a or GIF89a.
  if (startsWith([0x47, 0x49, 0x46, 0x38]) && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61)
    return 'gif'
  if (startsWith([0x50, 0x4B, 0x03, 0x04]))
    return 'zip'
  return undefined
}

/** An animated PNG declares an `acTL` chunk before its first `IDAT`; APNG is not a supported item type. */
function isAnimatedPng(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === 'acTL')
      return true
    if (type === 'IDAT')
      return false
    // Length, type, data, CRC.
    offset += 12 + view.getUint32(offset)
  }
  return false
}

function accept(info: StageItemFileInfo): StageItemFileInspection {
  return { ok: true, info }
}

function refuse(reason: StageItemFileRefusal): StageItemFileInspection {
  return { ok: false, reason }
}

function exceedsSide(width: number, height: number): boolean {
  return Math.max(width, height) > stageItemFileLimits.longestSidePx
}

async function inspectImage(file: Blob, mime: string): Promise<StageItemFileInspection> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  }
  catch {
    // The browser rejects data it cannot decode; that is the file's fault, reported as its refusal.
    return refuse('unreadable')
  }
  const { width, height } = bitmap
  bitmap.close()
  if (exceedsSide(width, height))
    return refuse('too-large')
  return accept({ format: 'image', mime, width, height })
}

async function inspectGif(file: Blob): Promise<StageItemFileInspection> {
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' })
  try {
    // The whole file is in memory, so `completed` settles once the decoder has parsed every frame header. The track
    // list fills separately: `selectedTrack` stays undefined until `tracks.ready` resolves.
    await Promise.all([decoder.tracks.ready, decoder.completed])
    const frames = decoder.tracks.selectedTrack?.frameCount ?? 0
    if (frames === 0)
      return refuse('unreadable')
    if (frames > stageItemFileLimits.gifFrames)
      return refuse('too-many-frames')
    // Frame 0 is composited onto the logical screen, so its size is the item's size.
    const { image } = await decoder.decode({ frameIndex: 0 })
    const width = image.displayWidth
    const height = image.displayHeight
    image.close()
    if (exceedsSide(width, height))
      return refuse('too-large')
    return accept({ format: 'gif', mime: 'image/gif', width, height, frames })
  }
  catch {
    // `completed` and `decode` reject with an EncodingError for truncated or corrupt data.
    return refuse('unreadable')
  }
  finally {
    decoder.close()
  }
}

/**
 * Reads the canvas size from a MOC3 file without the Cubism runtime. The header's section offset table holds the
 * offset of the canvas info at byte 0x44; the canvas info is five float32 values (pixels per unit, origin x, origin y,
 * width, height). Byte 5 is the endian flag, 0 for little-endian.
 */
function readMocCanvas(moc: Uint8Array): { width: number, height: number } | undefined {
  if (moc.length < 0x48)
    return undefined
  const view = new DataView(moc.buffer, moc.byteOffset, moc.byteLength)
  const littleEndian = moc[5] === 0
  const canvasOffset = view.getUint32(0x44, littleEndian)
  if (canvasOffset + 20 > moc.length)
    return undefined
  const width = view.getFloat32(canvasOffset + 12, littleEndian)
  const height = view.getFloat32(canvasOffset + 16, littleEndian)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return undefined
  return { width, height }
}

async function inspectLive2DZip(file: Blob): Promise<StageItemFileInspection> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer(), { decodeFileName: decodeZipFileName })
  }
  catch {
    return refuse('unreadable')
  }
  // The same structure checks as a display model import: a model3 entry or a loose MOC3, its textures, a MOC3 header.
  const report = await validateLive2DZip(file)
  if (report.status === 'INVALID' || !report.model.moc)
    return refuse('invalid-live2d')
  const canvas = readMocCanvas(await zip.file(report.model.moc.path)!.async('uint8array'))
  if (!canvas)
    return refuse('invalid-live2d')
  return accept({ format: 'live2d-zip', mime: 'application/zip', width: canvas.width, height: canvas.height, canvas })
}

/** Classifies a user file as a stage item, or names why it cannot be one. Never throws for bad file contents. */
export async function inspectStageItemFile(file: Blob): Promise<StageItemFileInspection> {
  const type = sniffType(new Uint8Array(await file.slice(0, 8).arrayBuffer()))
  switch (type) {
    case 'png': {
      if (file.size > stageItemFileLimits.imageBytes)
        return refuse('too-large')
      if (isAnimatedPng(new Uint8Array(await file.arrayBuffer())))
        return refuse('unsupported-type')
      return inspectImage(file, 'image/png')
    }
    case 'jpeg':
      if (file.size > stageItemFileLimits.imageBytes)
        return refuse('too-large')
      return inspectImage(file, 'image/jpeg')
    case 'gif':
      if (file.size > stageItemFileLimits.gifBytes)
        return refuse('too-large')
      return inspectGif(file)
    case 'zip':
      if (file.size > stageItemFileLimits.live2dZipBytes)
        return refuse('too-large')
      return inspectLive2DZip(file)
    default:
      return refuse('unsupported-type')
  }
}
