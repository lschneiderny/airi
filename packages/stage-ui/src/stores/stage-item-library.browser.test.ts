import type { Pinia } from 'pinia'

import JSZip from 'jszip'

import { stageItemFileLimits } from '@proj-airi/stage-ui-live2d/utils/stage-item-validator'
import { until } from '@vueuse/core'
import { createPinia, disposePinia, storeToRefs } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { storage } from '../database/storage'
import { resetRegisteredState } from '../persistence/state-registry'
import { useStageItemLibraryStore } from './stage-item-library'

const pinias: Pinia[] = []

/** One store per Pinia instance, like one library store per renderer window. */
async function openWindow() {
  const pinia = createPinia()
  pinias.push(pinia)
  const library = useStageItemLibraryStore(pinia)
  await library.load()
  return { pinia, library }
}

function ascii(text: string): number[] {
  return Array.from(text, char => char.charCodeAt(0))
}

async function png(width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')!
  context.fillStyle = '#3080ff'
  context.fillRect(0, 0, width, height)
  return canvas.convertToBlob({ type: 'image/png' })
}

async function jpeg(width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')!.fillRect(0, 0, width, height)
  return canvas.convertToBlob({ type: 'image/jpeg' })
}

/** Inserts an `acTL` chunk after `IHDR`, which makes the PNG an APNG by declaration. */
async function apng(): Promise<Blob> {
  const bytes = new Uint8Array(await (await png(4, 4)).arrayBuffer())
  const ihdrEnd = 8 + 25
  const acTL = [0, 0, 0, 8, ...ascii('acTL'), 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]
  return new Blob([bytes.slice(0, ihdrEnd), new Uint8Array(acTL), bytes.slice(ihdrEnd)])
}

/**
 * Encodes a GIF89a with a two-color table and `frames` frames of 100 ms. Each pixel is written as a clear code plus a
 * 3-bit color code, so the LZW code size never grows and the encoder stays trivial.
 */
function gif(frames: number, width = 2, height = 2): Uint8Array<ArrayBuffer> {
  const bytes: number[] = []
  const push16 = (value: number) => bytes.push(value & 0xFF, value >> 8)
  bytes.push(...ascii('GIF89a'))
  push16(width)
  push16(height)
  bytes.push(0x80, 0, 0, 0, 0, 0, 255, 255, 255)
  for (let frame = 0; frame < frames; frame++) {
    bytes.push(0x21, 0xF9, 4, 0, 10, 0, 0, 0)
    bytes.push(0x2C)
    push16(0)
    push16(0)
    push16(width)
    push16(height)
    bytes.push(0, 2)
    const codes: number[] = []
    for (let pixel = 0; pixel < width * height; pixel++)
      codes.push(4, (pixel + frame) % 2)
    codes.push(5)
    const data: number[] = []
    let accumulator = 0
    let bits = 0
    for (const code of codes) {
      accumulator |= code << bits
      bits += 3
      while (bits >= 8) {
        data.push(accumulator & 0xFF)
        accumulator >>= 8
        bits -= 8
      }
    }
    if (bits > 0)
      data.push(accumulator & 0xFF)
    for (let offset = 0; offset < data.length; offset += 255) {
      const block = data.slice(offset, offset + 255)
      bytes.push(block.length, ...block)
    }
    bytes.push(0)
  }
  bytes.push(0x3B)
  return new Uint8Array(bytes)
}

/** A MOC3 header whose canvas info says 100 x 120. Only the bytes the validators read are filled. */
function moc3(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(0x48 + 20)
  bytes.set(ascii('MOC3'))
  bytes[4] = 1
  const view = new DataView(bytes.buffer)
  view.setUint32(0x44, 0x48, true)
  for (const [index, value] of [100, 50, 60, 100, 120].entries())
    view.setFloat32(0x48 + index * 4, value, true)
  return bytes
}

async function zip(entries: Record<string, string | Uint8Array | Blob>): Promise<Blob> {
  const archive = new JSZip()
  for (const [path, content] of Object.entries(entries))
    archive.file(path, content)
  return archive.generateAsync({ type: 'blob' })
}

function named(content: BlobPart, name: string, type = ''): File {
  return new File([content], name, { type })
}

async function padTo(blob: Blob, size: number): Promise<Blob> {
  return new Blob([blob, new Uint8Array(size - blob.size)])
}

beforeEach(async () => {
  await storage.clear('stage-items')
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const pinia of pinias.splice(0))
    disposePinia(pinia)
})

describe('importFiles', () => {
  it('imports a PNG with its size and keeps it in the library', async () => {
    const { library } = await openWindow()

    const [result] = await library.importFiles([named(await png(64, 64), 'badge.png')])

    expect(result).toMatchObject({ ok: true, asset: { name: 'badge.png', format: 'image', mime: 'image/png', width: 64, height: 64 } })
    expect(library.assets.map(asset => asset.name)).toEqual(['badge.png'])
    const id = result.ok ? result.asset.id : ''
    expect((await library.blobOf(id))?.size).toBe((await png(64, 64)).size)
  })

  it('classifies by bytes, not by the name or the declared type', async () => {
    const { library } = await openWindow()

    const results = await library.importFiles([
      named(await png(8, 8), 'not-a.gif', 'image/gif'),
      named('just some text', 'not-an-image.png', 'image/png'),
      named(await jpeg(8, 6), 'photo.bin'),
    ])

    expect(results[0]).toMatchObject({ ok: true, asset: { format: 'image', mime: 'image/png' } })
    expect(results[1]).toEqual({ ok: false, name: 'not-an-image.png', reason: 'unsupported-type' })
    expect(results[2]).toMatchObject({ ok: true, asset: { format: 'image', mime: 'image/jpeg', width: 8, height: 6 } })
  })

  it('refuses SVG and animated PNG files as unsupported types', async () => {
    const { library } = await openWindow()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>'

    const results = await library.importFiles([named(svg, 'icon.svg', 'image/svg+xml'), named(await apng(), 'moving.png')])

    expect(results.map(result => !result.ok && result.reason)).toEqual(['unsupported-type', 'unsupported-type'])
    expect(library.assets).toEqual([])
  })

  it('accepts an image at the longest side limit and refuses one past it', async () => {
    const { library } = await openWindow()
    const limit = stageItemFileLimits.longestSidePx

    const results = await library.importFiles([
      named(await png(limit, 1), 'at-limit.png'),
      named(await png(limit + 1, 1), 'one-over.png'),
      named(await png(1, 5000), 'tall.png'),
    ])

    expect(results.map(result => result.ok || result.reason)).toEqual([true, 'too-large', 'too-large'])
  })

  it('accepts an image file at the byte limit and refuses one byte more', async () => {
    const { library } = await openWindow()
    const image = await png(4, 4)

    const results = await library.importFiles([
      named(await padTo(image, stageItemFileLimits.imageBytes), 'at-limit.png'),
      named(await padTo(image, stageItemFileLimits.imageBytes + 1), 'one-over.png'),
    ])

    expect(results.map(result => result.ok || result.reason)).toEqual([true, 'too-large'])
  })

  it('imports a three-frame GIF with its frame count and size', async () => {
    const { library } = await openWindow()

    const [result] = await library.importFiles([named(gif(3, 3, 2), 'wave.gif')])

    expect(result).toMatchObject({ ok: true, asset: { format: 'gif', mime: 'image/gif', width: 3, height: 2, frames: 3 } })
  })

  it('accepts a GIF at the frame limit and refuses one frame more', async () => {
    const { library } = await openWindow()

    const results = await library.importFiles([
      named(gif(stageItemFileLimits.gifFrames, 1, 1), 'at-limit.gif'),
      named(gif(stageItemFileLimits.gifFrames + 1, 1, 1), 'one-over.gif'),
    ])

    expect(results.map(result => result.ok || result.reason)).toEqual([true, 'too-many-frames'])
  })

  it('refuses a GIF past the size limits and a truncated GIF', async () => {
    const { library } = await openWindow()
    const truncated = gif(3).slice(0, 13 + 6 + 8 + 10 + 2)

    const results = await library.importFiles([
      named(gif(1, stageItemFileLimits.longestSidePx + 1, 1), 'wide.gif'),
      named(await padTo(new Blob([gif(1)]), stageItemFileLimits.gifBytes + 1), 'heavy.gif'),
      named(truncated, 'cut.gif'),
    ])

    expect(results.map(result => result.ok || result.reason)).toEqual(['too-large', 'too-large', 'unreadable'])
  })

  it('imports a Live2D zip with its canvas size and refuses a zip without a model', async () => {
    const { library } = await openWindow()
    const model = await zip({
      'item/item.model3.json': JSON.stringify({ Version: 3, FileReferences: { Moc: 'item.moc3', Textures: ['texture.png'] } }),
      'item/item.moc3': moc3(),
      'item/texture.png': await png(4, 4),
    })

    const results = await library.importFiles([
      named(model, 'hat.zip'),
      named(await zip({ 'readme.txt': 'no model here' }), 'notes.zip'),
    ])

    expect(results[0]).toMatchObject({ ok: true, asset: { format: 'live2d-zip', width: 100, height: 120, canvas: { width: 100, height: 120 } } })
    expect(results[1]).toEqual({ ok: false, name: 'notes.zip', reason: 'invalid-live2d' })
  })

  it('fills the library up to its limit and refuses the import past it', async () => {
    const { library } = await openWindow()
    await Promise.all(Array.from({ length: 199 }, (_, index) => storage.setItemRaw(`stage-items:entries:asset-seed-${index}`, {
      id: `asset-seed-${index}`,
      name: 'seed.png',
      format: 'image',
      mime: 'image/png',
      width: 1,
      height: 1,
      importedAt: 0,
    })))

    const results = await library.importFiles([named(await png(4, 4), 'last.png'), named(await png(4, 4), 'past.png')])

    expect(results.map(result => result.ok || result.reason)).toEqual([true, 'library-full'])
    expect(library.assets).toHaveLength(200)
  })

  it('reports storage-full when the browser refuses the write, and leaves no entry or file behind', async () => {
    const { library } = await openWindow()
    const put = IDBObjectStore.prototype.put
    // The file write succeeds and the entry write fails, so the rollback of a stored file is what the test proves.
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.transaction.db.name === 'airi-stage-item-library' && String(key).startsWith('entries:'))
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return put.call(this, value, key)
    })

    const [result] = await library.importFiles([named(await png(4, 4), 'big.png')])

    expect(result).toEqual({ ok: false, name: 'big.png', reason: 'storage-full' })
    expect(await storage.getKeys('stage-items')).toEqual([])
    expect(library.assets).toEqual([])
  })
})

describe('other windows', () => {
  it('sees an import after the broadcast', async () => {
    const first = await openWindow()
    const second = await openWindow()

    const [result] = await first.library.importFiles([named(await png(4, 4), 'shared.png')])
    const id = result.ok ? result.asset.id : ''

    await until(storeToRefs(second.library).assets).toMatch(assets => assets.some(asset => asset.id === id), { timeout: 5_000, throwOnTimeout: true })
  })

  it('reports a removal in this window and in another, after the library excludes the asset', async () => {
    const first = await openWindow()
    const second = await openWindow()
    const [result] = await first.library.importFiles([named(await png(4, 4), 'gone.png')])
    const id = result.ok ? result.asset.id : ''
    await until(storeToRefs(second.library).assets).toMatch(assets => assets.length === 1, { timeout: 5_000, throwOnTimeout: true })
    const local = new Promise<readonly string[]>(resolve => first.library.onAssetsRemoved(resolve))
    const remote = new Promise<readonly string[]>(resolve => second.library.onAssetsRemoved(resolve))

    await first.library.remove(id)

    expect(await local).toEqual([id])
    expect(await remote).toEqual([id])
    expect(first.library.assets).toEqual([])
    expect(second.library.assets).toEqual([])
    expect(await first.library.blobOf(id)).toBeNull()
  })
})

it('is emptied by Delete all data, which reports every removed asset', async () => {
  const { pinia, library } = await openWindow()
  const results = await library.importFiles([named(await png(4, 4), 'a.png'), named(gif(3), 'b.gif')])
  const ids = results.map(result => result.ok ? result.asset.id : '')
  const removed = new Promise<readonly string[]>(resolve => library.onAssetsRemoved(resolve))

  await resetRegisteredState({ pinia }, ['stage-item-library'])

  expect([...await removed].sort()).toEqual([...ids].sort())
  expect(library.assets).toEqual([])
  expect(await storage.getKeys('stage-items')).toEqual([])
})
