import type { MaybeRefOrGetter, Ref } from 'vue'

import { toRef, unrefElement, useElementBounding } from '@vueuse/core'
import { clamp } from 'es-toolkit/math'
import { computed } from 'vue'

interface CircleHitTestInput {
  gl: WebGL2RenderingContext | WebGLRenderingContext
  clientX: number
  clientY: number
  left: number
  top: number
  width: number
  height: number
  radius: number
  threshold: number
}

/** The readPixels rectangle that holds the hit circle, in drawing-buffer pixels, and the circle centre in that space. */
interface RegionRead {
  startX: number
  startY: number
  readWidth: number
  readHeight: number
  centerX: number
  centerY: number
  scaleX: number
  scaleY: number
  radius: number
}

/** `null` when the point is outside the canvas or the canvas has no drawing buffer: the region counts as transparent. */
function regionReadOf(gl: WebGL2RenderingContext | WebGLRenderingContext, input: Omit<CircleHitTestInput, 'gl' | 'threshold'>): RegionRead | null {
  const { clientX, clientY, left, top, width, height, radius } = input
  if (!width || !height)
    return null

  if (gl.drawingBufferWidth <= 0 || gl.drawingBufferHeight <= 0)
    return null

  const xIn = clientX - left
  const yIn = clientY - top
  const inCanvas = xIn >= 0 && yIn >= 0 && xIn < width && yIn < height
  if (!inCanvas)
    return null

  const scaleX = gl.drawingBufferWidth / width
  const scaleY = gl.drawingBufferHeight / height
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY))
    return null

  // Translate client-space coords into WebGL buffer space (respecting DPI scaling and flipped Y),
  // then read a bounding box that fully contains the desired radius circle. Later we re-check
  // the circle constraint in CPU land to avoid missing hits at the edges.
  const centerX = Math.floor(xIn * scaleX)
  const centerY = Math.floor(gl.drawingBufferHeight - 1 - yIn * scaleY)

  const radiusX = Math.ceil(radius * scaleX)
  const radiusY = Math.ceil(radius * scaleY)

  const startX = clamp(centerX - radiusX, 0, gl.drawingBufferWidth - 1)
  const endX = clamp(centerX + radiusX, 0, gl.drawingBufferWidth - 1)
  const startY = clamp(centerY - radiusY, 0, gl.drawingBufferHeight - 1)
  const endY = clamp(centerY + radiusY, 0, gl.drawingBufferHeight - 1)

  return { startX, startY, readWidth: endX - startX + 1, readHeight: endY - startY + 1, centerX, centerY, scaleX, scaleY, radius }
}

function regionIsTransparent(read: RegionRead, data: Uint8Array, threshold: number): boolean {
  const radiusSq = read.radius * read.radius

  for (let y = 0; y < read.readHeight; y += 1) {
    const gy = read.startY + y
    const dy = (gy - read.centerY) / read.scaleY
    const dySq = dy * dy

    for (let x = 0; x < read.readWidth; x += 1) {
      const gx = read.startX + x
      const dx = (gx - read.centerX) / read.scaleX
      if (dx * dx + dySq > radiusSq)
        continue

      const index = (y * read.readWidth + x) * 4
      const alpha = data[index + 3]
      if (alpha >= threshold)
        return false
    }
  }

  return true
}

export function isCanvasRegionTransparent({ gl, threshold, ...input }: CircleHitTestInput) {
  const read = regionReadOf(gl, input)
  if (!read)
    return true

  const data = new Uint8Array(read.readWidth * read.readHeight * 4)

  try {
    gl.readPixels(read.startX, read.startY, read.readWidth, read.readHeight, gl.RGBA, gl.UNSIGNED_BYTE, data)
  }
  catch {
    return true
  }

  return regionIsTransparent(read, data, threshold)
}

/**
 * Reads the hit region of a WebGL2 canvas without waiting for the GPU.
 *
 * A synchronous `readPixels` on the default framebuffer blocks until the GPU has finished the frame, which costs
 * several milliseconds when it runs right after a render. `request` instead copies the region into a pixel-pack
 * buffer and fences the copy; `poll` returns the transparency on the poll after the one that first sees the fence
 * signalled. Copying at once still stalled on about 2 % of reads (Chromium finishes the copy through a synchronous GPU
 * process round trip), so the answer waits one more poll.
 * One read is in flight at a time. The canvas must keep its drawing buffer (`preserveDrawingBuffer`) so a request
 * made outside the render callback still sees the last frame. Call `dispose` when the context goes away.
 */
export class CanvasRegionAlphaReader {
  private buffer: WebGLBuffer | null = null
  private bufferBytes = 0
  private inFlight: { sync: WebGLSync, read: RegionRead, threshold: number, signalled: boolean } | null = null

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** Whether a read is in flight, so `poll` may answer. */
  get pending(): boolean {
    return this.inFlight !== null
  }

  /**
   * Starts a read of the region around the point. `transparent` means the point is outside the canvas and no read is
   * needed; `busy` means the previous read has not finished, so this request is dropped.
   */
  request(input: Omit<CircleHitTestInput, 'gl'>): 'started' | 'busy' | 'transparent' {
    if (this.inFlight)
      return 'busy'
    const { gl } = this
    const read = regionReadOf(gl, input)
    if (!read)
      return 'transparent'

    const bytes = read.readWidth * read.readHeight * 4
    this.buffer ??= gl.createBuffer()
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer)
    if (bytes > this.bufferBytes) {
      gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ)
      this.bufferBytes = bytes
    }
    gl.readPixels(read.startX, read.startY, read.readWidth, read.readHeight, gl.RGBA, gl.UNSIGNED_BYTE, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    if (!sync)
      return 'transparent'
    gl.flush()
    this.inFlight = { sync, read, threshold: input.threshold, signalled: false }
    return 'started'
  }

  /** The transparency of the finished read, or `undefined` while none has finished since the last poll. */
  poll(): boolean | undefined {
    const pending = this.inFlight
    if (!pending)
      return undefined
    const { gl } = this
    if (!pending.signalled) {
      const status = gl.clientWaitSync(pending.sync, 0, 0)
      if (status === gl.TIMEOUT_EXPIRED)
        return undefined
      if (status === gl.WAIT_FAILED) {
        gl.deleteSync(pending.sync)
        this.inFlight = null
        return undefined
      }
      pending.signalled = true
      return undefined
    }

    gl.deleteSync(pending.sync)
    this.inFlight = null

    const data = new Uint8Array(pending.read.readWidth * pending.read.readHeight * 4)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer)
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    return regionIsTransparent(pending.read, data, pending.threshold)
  }

  dispose(): void {
    if (this.inFlight)
      this.gl.deleteSync(this.inFlight.sync)
    this.inFlight = null
    if (this.buffer)
      this.gl.deleteBuffer(this.buffer)
    this.buffer = null
    this.bufferBytes = 0
  }
}

export function useCanvasPixelAtPoint(
  canvas: MaybeRefOrGetter<HTMLCanvasElement | undefined>,
  pointX: MaybeRefOrGetter<number>,
  pointY: MaybeRefOrGetter<number>,
): {
  inCanvas: Ref<boolean>
  pixel: Ref<Uint8Array | number[]>
} {
  const canvasRef = toRef(canvas)

  const { left, top, width, height } = useElementBounding(canvasRef)
  const xRef = toRef(pointX)
  const yRef = toRef(pointY)

  const inCanvas = computed(() => {
    if (canvasRef.value == null) {
      return false
    }

    const xIn = xRef.value - left.value
    const yIn = yRef.value - top.value
    return xIn >= 0 && yIn >= 0 && xIn < width.value && yIn < height.value
  })

  const pixel = computed(() => {
    const el = unrefElement(canvasRef)
    if (!el || !inCanvas.value)
      return new Uint8Array([0, 0, 0, 0])

    const gl = (el.getContext('webgl2') || el.getContext('webgl')) as WebGL2RenderingContext | WebGLRenderingContext | null
    if (!gl)
      return new Uint8Array([0, 0, 0, 0])

    const xIn = xRef.value - left.value
    const yIn = yRef.value - top.value

    const scaleX = gl.drawingBufferWidth / width.value
    const scaleY = gl.drawingBufferHeight / height.value
    const pixelX = Math.floor(xIn * scaleX)
    // Flip Y; subtract 1 to avoid top-edge off-by-one
    const pixelY = Math.floor(gl.drawingBufferHeight - 1 - yIn * scaleY)

    const data = new Uint8Array(4)
    try {
      gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data)
    }
    catch {
      return new Uint8Array([0, 0, 0, 0])
    }

    return data
  })

  return {
    inCanvas,
    pixel,
  }
}

export function useCanvasPixelIsTransparent(
  pixel: Ref<Uint8Array | number[]>,
  threshold = 10,
): Ref<boolean> {
  return computed(() => pixel.value[3] < threshold)
}

export function useCanvasPixelIsTransparentAtPoint(
  canvas: MaybeRefOrGetter<HTMLCanvasElement | undefined>,
  pointX: MaybeRefOrGetter<number>,
  pointY: MaybeRefOrGetter<number>,
  optionsOrThreshold: number | { threshold?: number, regionRadius?: number } = 10,
): Ref<boolean> {
  const options = typeof optionsOrThreshold === 'number'
    ? { threshold: optionsOrThreshold, regionRadius: 0 }
    : optionsOrThreshold

  const threshold = options?.threshold ?? 10
  const radius = Math.max(0, options?.regionRadius ?? 0)

  if (radius === 0) {
    const { pixel } = useCanvasPixelAtPoint(canvas, pointX, pointY)
    return useCanvasPixelIsTransparent(pixel, threshold)
  }

  const canvasRef = toRef(canvas)
  const xRef = toRef(pointX)
  const yRef = toRef(pointY)
  const { left, top, width, height } = useElementBounding(canvasRef)

  return computed(() => {
    const el = unrefElement(canvasRef)
    if (!el)
      return true

    const gl = (el.getContext('webgl2') || el.getContext('webgl')) as WebGL2RenderingContext | WebGLRenderingContext | null
    if (!gl)
      return true

    return isCanvasRegionTransparent({
      gl,
      clientX: xRef.value,
      clientY: yRef.value,
      left: left.value,
      top: top.value,
      width: width.value,
      height: height.value,
      radius,
      threshold,
    })
  })
}
