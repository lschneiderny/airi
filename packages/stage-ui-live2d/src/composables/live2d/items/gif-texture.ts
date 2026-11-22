import { BaseTexture, Texture } from '@pixi/core'

/** One centisecond, the unit of a GIF frame delay. */
const gifDelayUnitMs = 10

/**
 * Reads each frame's stated delay from GIF bytes, in milliseconds, without decoding pixels.
 *
 * `ImageDecoder` reports a frame's duration only by decoding it, and the frame
 * clock needs every duration up front. The walk follows the GIF89a block layout:
 * header and logical screen (13 bytes), the global color table, then extensions
 * (`0x21`), image descriptors (`0x2C`), and the trailer (`0x3B`). A Graphic
 * Control Extension states the delay of the image that follows it. A frame
 * without one reads 0, which the frame clock plays at its default. The walk stops
 * at the first byte it cannot read, so malformed data yields fewer delays.
 */
export function readGifFrameDelaysMs(bytes: Uint8Array): number[] {
  const delaysMs: number[] = []
  if (bytes.length < 13)
    return delaysMs

  const colorTableBytes = (packed: number) => (packed & 0x80) ? 3 * (2 << (packed & 0x07)) : 0
  let offset = 13 + colorTableBytes(bytes[10])
  const skipSubBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++]
      if (size === 0)
        return
      offset += size
    }
  }

  let statedDelayMs = 0
  while (offset < bytes.length) {
    const introducer = bytes[offset++]
    if (introducer === 0x21) {
      const label = bytes[offset++]
      // Block size (4), packed fields, delay as little-endian 16 bits, transparent index.
      if (label === 0xF9 && bytes[offset] >= 4)
        statedDelayMs = (bytes[offset + 2] | (bytes[offset + 3] << 8)) * gifDelayUnitMs
      skipSubBlocks()
      continue
    }
    if (introducer === 0x2C) {
      // Left, top, width, height (2 bytes each), then the packed fields.
      const packed = bytes[offset + 8]
      offset += 9 + colorTableBytes(packed)
      // The LZW minimum code size precedes the image data.
      offset++
      skipSubBlocks()
      delaysMs.push(statedDelayMs)
      statedDelayMs = 0
      continue
    }
    // The trailer, or a byte that starts no block.
    break
  }
  return delaysMs
}

/**
 * Plays an animated GIF into one texture, decoding frames on demand.
 *
 * It holds at most the shown frame, drawn into its canvas, and one decoded frame
 * ahead; it never holds all frames. Every decoded `VideoFrame` is drawn into the
 * canvas and closed, and the texture re-uploads the canvas on its next bind.
 * Decoding runs outside the render pass: `show` only starts work and never
 * throws. A frame that fails to decode calls `onFailed` once and stops the
 * animation; `destroy` closes the decoder, which cancels a pending decode.
 */
export class Live2DGifTexture {
  readonly texture: Texture
  /** The stated delay of each frame, 0 where none is stated; one entry per decodable frame. */
  readonly frameDurationsMs: readonly number[]

  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private shownFrame = 0
  private wantedFrame = 0
  private pendingFrame: number | undefined
  private ahead: { index: number, image: VideoFrame } | undefined
  private failed = false
  private destroyed = false

  private constructor(
    private readonly decoder: ImageDecoder,
    firstFrame: VideoFrame,
    frameDurationsMs: readonly number[],
    private readonly onFailed: (error: unknown) => void,
  ) {
    this.frameDurationsMs = frameDurationsMs
    this.canvas = document.createElement('canvas')
    this.canvas.width = firstFrame.displayWidth
    this.canvas.height = firstFrame.displayHeight
    this.context = this.canvas.getContext('2d')!
    this.texture = new Texture(new BaseTexture(this.canvas))
    this.draw(firstFrame)
  }

  /**
   * Opens a GIF and shows its first frame.
   *
   * Rejects when the data has no decodable first frame. A later frame can still
   * be corrupt, because the library validator decodes only frame 0; that failure
   * reaches `onFailed` when the frame is due.
   */
  static async open(bytes: ArrayBuffer, onFailed: (error: unknown) => void): Promise<Live2DGifTexture> {
    const decoder = new ImageDecoder({ data: bytes, type: 'image/gif' })
    try {
      // The whole file is in memory, so `completed` settles once every frame header is parsed.
      await Promise.all([decoder.tracks.ready, decoder.completed])
      const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0
      const statedDelaysMs = readGifFrameDelaysMs(new Uint8Array(bytes))
      const frameDurationsMs = Array.from({ length: Math.max(1, frameCount) }, (_, frame) => statedDelaysMs[frame] ?? 0)
      const { image } = await decoder.decode({ frameIndex: 0 })
      return new Live2DGifTexture(decoder, image, frameDurationsMs, onFailed)
    }
    catch (error) {
      decoder.close()
      throw error
    }
  }

  /** Asks for a frame. It shows at once when it was decoded ahead, otherwise as soon as its decode finishes. */
  show(frameIndex: number) {
    if (this.failed || this.destroyed)
      return
    this.wantedFrame = frameIndex
    if (frameIndex === this.shownFrame)
      return

    const ahead = this.ahead
    if (ahead?.index === frameIndex) {
      this.ahead = undefined
      this.present(ahead)
      return
    }
    this.decode(frameIndex)
  }

  destroy() {
    if (this.destroyed)
      return
    this.destroyed = true
    this.ahead?.image.close()
    this.ahead = undefined
    this.decoder.close()
    this.texture.destroy(true)
  }

  private present(frame: { index: number, image: VideoFrame }) {
    this.draw(frame.image)
    this.shownFrame = frame.index
    if (this.frameDurationsMs.length > 1)
      this.decode((frame.index + 1) % this.frameDurationsMs.length)
  }

  private draw(image: VideoFrame) {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.context.drawImage(image, 0, 0)
    image.close()
    this.texture.baseTexture.update()
  }

  /** Decodes one frame at a time; a request while one is in flight waits for the next `show`. */
  private decode(index: number) {
    if (this.pendingFrame !== undefined)
      return
    this.pendingFrame = index
    this.decoder.decode({ frameIndex: index }).then(({ image }) => {
      this.pendingFrame = undefined
      if (this.destroyed || this.failed) {
        image.close()
        return
      }
      this.ahead?.image.close()
      this.ahead = { index, image }
      // The frame came due while it decoded.
      if (index === this.wantedFrame && index !== this.shownFrame) {
        this.ahead = undefined
        this.present({ index, image })
      }
    }, (error: unknown) => {
      this.pendingFrame = undefined
      // `close` rejects the pending decode; that is the cancellation, not a failure.
      if (this.destroyed || this.failed)
        return
      this.failed = true
      this.onFailed(error)
    })
  }
}
