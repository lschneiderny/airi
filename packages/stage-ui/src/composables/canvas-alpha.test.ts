import { describe, expect, it } from 'vitest'

import { CanvasRegionAlphaReader, isCanvasRegionTransparent } from './canvas-alpha'

interface GlMockOptions {
  hotPixel?: { x: number, y: number, alpha?: number }
  width?: number
  height?: number
}

/**
 * Minimal WebGL context mock that fills readPixels output with transparent pixels,
 * except for an optional single hot pixel where alpha is set. Coordinates are in
 * drawing buffer space, matching readPixels inputs.
 */
function createGlMock(options: GlMockOptions = {}) {
  const drawingBufferWidth = options.width ?? 100
  const drawingBufferHeight = options.height ?? 100
  const hotPixel = options.hotPixel

  const gl = {
    drawingBufferWidth,
    drawingBufferHeight,
    readPixels: (
      startX: number,
      startY: number,
      readWidth: number,
      readHeight: number,
      _format: number,
      _type: number,
      data: Uint8Array,
    ) => {
      data.fill(0)

      if (!hotPixel)
        return

      const { x, y, alpha = 255 } = hotPixel
      const withinX = x >= startX && x < startX + readWidth
      const withinY = y >= startY && y < startY + readHeight
      if (!withinX || !withinY)
        return

      const relX = x - startX
      const relY = y - startY
      const index = (relY * readWidth + relX) * 4 + 3
      data[index] = alpha
    },
  }

  return gl as unknown as WebGLRenderingContext
}

describe('isCanvasRegionTransparent', () => {
  it('returns true when cursor is outside canvas bounds', () => {
    const gl = createGlMock()

    const result = isCanvasRegionTransparent({
      gl,
      clientX: 150,
      clientY: 150,
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      radius: 10,
      threshold: 10,
    })

    expect(result).toBe(true)
  })

  it('returns false when an opaque pixel is inside the circular region', () => {
    const gl = createGlMock({ hotPixel: { x: 50, y: 49, alpha: 255 } })

    const result = isCanvasRegionTransparent({
      gl,
      clientX: 50,
      clientY: 50,
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      radius: 10,
      threshold: 10,
    })

    expect(result).toBe(false)
  })

  it('ignores opaque pixels outside the circular region but inside read bounds', () => {
    const gl = createGlMock({ hotPixel: { x: 80, y: 80, alpha: 255 } })

    const result = isCanvasRegionTransparent({
      gl,
      clientX: 50,
      clientY: 50,
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      radius: 5,
      threshold: 10,
    })

    expect(result).toBe(true)
  })

  it('uses only the exact cursor pixel when the radius is zero', () => {
    const gl = createGlMock({ hotPixel: { x: 50, y: 49, alpha: 255 } })

    const result = isCanvasRegionTransparent({
      gl,
      clientX: 50,
      clientY: 50,
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      radius: 0,
      threshold: 10,
    })

    expect(result).toBe(false)
  })
})

/**
 * WebGL2 mock for the asynchronous reader: readPixels into the bound pixel-pack buffer copies the region (one opaque
 * pixel at `hot`), and the fence stays unsignalled until the test calls `signal`.
 */
function createGl2Mock(hot: { x: number, y: number } | null) {
  let signalled = false
  let packed = new Uint8Array(0)
  const calls = { readPixels: 0, deleteSync: 0, deleteBuffer: 0 }
  const gl = {
    drawingBufferWidth: 100,
    drawingBufferHeight: 100,
    PIXEL_PACK_BUFFER: 0x88EB,
    STREAM_READ: 0x88E1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    TIMEOUT_EXPIRED: 0x911B,
    CONDITION_SATISFIED: 0x911C,
    WAIT_FAILED: 0x911D,
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: (_target: number, bytes: number) => {
      packed = new Uint8Array(bytes)
    },
    readPixels: (startX: number, startY: number, width: number, height: number) => {
      calls.readPixels += 1
      packed.fill(0)
      if (hot && hot.x >= startX && hot.x < startX + width && hot.y >= startY && hot.y < startY + height)
        packed[((hot.y - startY) * width + (hot.x - startX)) * 4 + 3] = 255
    },
    fenceSync: () => ({}),
    flush: () => {},
    clientWaitSync: () => (signalled ? 0x911C : 0x911B),
    getBufferSubData: (_target: number, _offset: number, data: Uint8Array) => data.set(packed.subarray(0, data.length)),
    deleteSync: () => {
      calls.deleteSync += 1
    },
    deleteBuffer: () => {
      calls.deleteBuffer += 1
    },
  }
  return { gl: gl as unknown as WebGL2RenderingContext, calls, signal: () => signalled = true }
}

const centre = { clientX: 50, clientY: 50, left: 0, top: 0, width: 100, height: 100, radius: 0, threshold: 10 }

describe('canvasRegionAlphaReader', () => {
  it('answers one poll after the GPU fence has signalled, and drops requests while a read is in flight', () => {
    const { gl, calls, signal } = createGl2Mock({ x: 50, y: 49 })
    const reader = new CanvasRegionAlphaReader(gl)

    expect(reader.request(centre)).toBe('started')
    expect(reader.poll()).toBeUndefined()
    expect(reader.request(centre)).toBe('busy')
    expect(calls.readPixels).toBe(1)

    signal()
    expect(reader.poll()).toBeUndefined()
    expect(reader.request(centre)).toBe('busy')
    expect(reader.poll()).toBe(false)
    expect(calls.deleteSync).toBe(1)
    expect(reader.poll()).toBeUndefined()
  })

  it('reports a transparent region, and a point outside the canvas without reading', () => {
    const { gl, calls, signal } = createGl2Mock(null)
    const reader = new CanvasRegionAlphaReader(gl)

    expect(reader.request({ ...centre, clientX: 150 })).toBe('transparent')
    expect(calls.readPixels).toBe(0)
    reader.request(centre)
    signal()
    reader.poll()
    expect(reader.poll()).toBe(true)

    reader.dispose()
    expect(calls.deleteBuffer).toBe(1)
  })
})
