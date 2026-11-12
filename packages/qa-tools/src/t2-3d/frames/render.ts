import { Transformer } from '@napi-rs/image'

import { drawText, GLYPH_HEIGHT, GLYPH_WIDTH } from './font'

export type FrameView = 'front' | 'side'

/** One fixed scale for every frame of a command: pixels per model unit, and the trace height drawn at the image top. */
export interface Framing {
  readonly width: number
  readonly height: number
  readonly scale: number
  readonly top: number
}

const BACKGROUND = 244
const LIGHT = (() => {
  const l = [0.35, 0.5, 1]
  const n = Math.hypot(...l)
  return l.map(v => v / n)
})()

/** Fits the bind pose's height into 92 % of the image, so every frame of the command is drawn at that one scale. */
export function framingFor(bind: Float32Array, width: number, height: number): Framing {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 1; i < bind.length; i += 3) {
    lo = Math.min(lo, bind[i])
    hi = Math.max(hi, bind[i])
  }
  const scale = 0.92 * height / Math.max(hi - lo, 1e-9)
  return { width, height, scale, top: hi + 0.04 * height / scale }
}

/**
 * Flat-shaded z-buffered orthographic drawing of triangles in the trace's axes (y up, z her forward, x = up x forward,
 * which is her left). Neither view is mirrored. Front: seen from in front of her, her left (+x) on the image right.
 * Side: seen from her left (+x), her front (+z) on the image left. `centre` is the trace x (front) or z (side) drawn at
 * the image's horizontal centre. Returns RGB bytes.
 */
export function rasterize(vertices: Float32Array, triangles: ArrayLike<number>, view: FrameView, framing: Framing, centre: number): Uint8Array {
  const { width, height, scale, top } = framing
  const rgb = new Uint8Array(width * height * 3).fill(BACKGROUND)
  const depth = new Float32Array(width * height).fill(Number.NEGATIVE_INFINITY)
  const sx = (i: number) => view === 'front' ? width / 2 + scale * (vertices[i] - centre) : width / 2 - scale * (vertices[i + 2] - centre)
  const sy = (i: number) => (top - vertices[i + 1]) * scale
  const sz = (i: number) => view === 'front' ? vertices[i + 2] : vertices[i]
  for (let f = 0; f + 2 < triangles.length; f += 3) {
    const a = triangles[f] * 3
    const b = triangles[f + 1] * 3
    const c = triangles[f + 2] * 3
    const [ax, ay, bx, by, cx, cy] = [sx(a), sy(a), sx(b), sy(b), sx(c), sy(c)]
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (Math.abs(area) < 1e-9)
      continue
    const e1 = [vertices[b] - vertices[a], vertices[b + 1] - vertices[a + 1], vertices[b + 2] - vertices[a + 2]]
    const e2 = [vertices[c] - vertices[a], vertices[c + 1] - vertices[a + 1], vertices[c + 2] - vertices[a + 2]]
    const normal = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    const length = Math.hypot(...normal) || 1
    const shade = 0.25 + 0.75 * Math.abs((normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]) / length)
    const grey = Math.round(255 * shade)
    const [za, zb, zc] = [sz(a), sz(b), sz(c)]
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(height - 1, Math.ceil(Math.max(ay, by, cy))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
        const px = x + 0.5
        const py = y + 0.5
        const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area
        const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0)
          continue
        const z = w0 * za + w1 * zb + w2 * zc
        const k = y * width + x
        if (z <= depth[k])
          continue
        depth[k] = z
        rgb.set([Math.round(grey * 0.86), Math.round(grey * 0.88), grey], k * 3)
      }
    }
  }
  return rgb
}

export async function encodePng(rgb: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++)
    rgba.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255], i * 4)
  return Transformer.fromRgbaPixels(rgba, width, height).png()
}

const CAPTION_SCALE = 2

function wrap(lines: readonly string[], columns: number): string[] {
  return lines.flatMap(line => line.length <= columns ? [line] : Array.from({ length: Math.ceil(line.length / columns) }, (_, i) => line.slice(i * columns, (i + 1) * columns)))
}

export function contactSheet(cells: readonly { readonly rgb: Uint8Array, readonly caption: readonly string[] }[], cellWidth: number, cellHeight: number, perRow: number): { rgb: Uint8Array, width: number, height: number } {
  const columns = Math.floor((cellWidth - 4) / (GLYPH_WIDTH * CAPTION_SCALE))
  const captions = cells.map(cell => wrap(cell.caption, columns))
  const captionHeight = Math.max(1, ...captions.map(c => c.length)) * GLYPH_HEIGHT * CAPTION_SCALE + 6
  const rowHeight = cellHeight + captionHeight
  const width = perRow * cellWidth
  const height = Math.ceil(cells.length / perRow) * rowHeight
  const rgb = new Uint8Array(width * height * 3).fill(255)
  cells.forEach((cell, n) => {
    const x0 = (n % perRow) * cellWidth
    const y0 = Math.floor(n / perRow) * rowHeight
    for (let y = 0; y < cellHeight; y++)
      rgb.set(cell.rgb.subarray(y * cellWidth * 3, (y + 1) * cellWidth * 3), ((y0 + y) * width + x0) * 3)
    captions[n].forEach((line, i) => drawText(rgb, width, height, x0 + 2, y0 + cellHeight + 3 + i * GLYPH_HEIGHT * CAPTION_SCALE, line, CAPTION_SCALE))
  })
  return { rgb, width, height }
}
