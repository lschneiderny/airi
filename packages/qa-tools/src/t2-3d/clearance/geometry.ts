/** A point in model units. */
export type Point = readonly [number, number, number]

/** Distance from `p` to the segment `a`-`b`; a zero-length segment measures to `a`. */
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  const lengthSquared = dx * dx + dy * dy + dz * dz
  const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / lengthSquared))
  return Math.hypot(p[0] - a[0] - along * dx, p[1] - a[1] - along * dy, p[2] - a[2] - along * dz)
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

export function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]
}

/**
 * Where the segment `p`-`q` crosses the triangle whose corners start at offsets `a`, `b` and `c` of `vertices`
 * (Möller-Trumbore): the share of the segment before the crossing, or null when it does not cross. A segment that lies
 * in the triangle's plane never crosses.
 */
export function segmentCrossing(p: Point, q: Point, vertices: Float64Array, a: number, b: number, c: number): number | null {
  const e1x = vertices[b] - vertices[a]
  const e1y = vertices[b + 1] - vertices[a + 1]
  const e1z = vertices[b + 2] - vertices[a + 2]
  const e2x = vertices[c] - vertices[a]
  const e2y = vertices[c + 1] - vertices[a + 1]
  const e2z = vertices[c + 2] - vertices[a + 2]
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const dz = q[2] - p[2]
  const px = dy * e2z - dz * e2y
  const py = dz * e2x - dx * e2z
  const pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (Math.abs(det) < 1e-12)
    return null
  const tx = p[0] - vertices[a]
  const ty = p[1] - vertices[a + 1]
  const tz = p[2] - vertices[a + 2]
  const u = (tx * px + ty * py + tz * pz) / det
  if (u < 0 || u > 1)
    return null
  const qx = ty * e1z - tz * e1y
  const qy = tz * e1x - tx * e1z
  const qz = tx * e1y - ty * e1x
  const w = (dx * qx + dy * qy + dz * qz) / det
  if (w < 0 || u + w > 1)
    return null
  const along = (e2x * qx + e2y * qy + e2z * qz) / det
  return along < 0 || along > 1 ? null : along
}

/**
 * Linear blend skinning: each vertex's bind position (3 per vertex) through its up to four bones' skinning matrices
 * (column-major, 16 per bone), weighted by its weights (4 per vertex, summing to 1), into `out`.
 */
export function skinVertices(bind: Float64Array, skinIndex: Uint16Array, skinWeight: Float32Array, matrices: Float64Array, out: Float64Array): void {
  const count = bind.length / 3
  for (let i = 0; i < count; i++) {
    const x = bind[i * 3]
    const y = bind[i * 3 + 1]
    const z = bind[i * 3 + 2]
    let ox = 0
    let oy = 0
    let oz = 0
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight[i * 4 + k]
      if (weight === 0)
        continue
      const m = skinIndex[i * 4 + k] * 16
      ox += weight * (matrices[m] * x + matrices[m + 4] * y + matrices[m + 8] * z + matrices[m + 12])
      oy += weight * (matrices[m + 1] * x + matrices[m + 5] * y + matrices[m + 9] * z + matrices[m + 13])
      oz += weight * (matrices[m + 2] * x + matrices[m + 6] * y + matrices[m + 10] * z + matrices[m + 14])
    }
    out[i * 3] = ox
    out[i * 3 + 1] = oy
    out[i * 3 + 2] = oz
  }
}

/** The value at share `at` of the sorted values (index `floor(n * at)`, clamped), or 0 without values. */
export function quantile(values: readonly number[], at: number): number {
  if (!values.length)
    return 0
  const sorted = [...values].sort((x, y) => x - y)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * at))]
}
