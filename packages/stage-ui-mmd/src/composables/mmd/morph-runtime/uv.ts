import type { PmxObject } from '@moeru/three-mmd'
import type { BufferAttribute } from 'three'

/** Type-3 offsets only; the expansion compiler reports additional UV once. */
export class UvMorphApplier {
  private readonly base: Float32Array
  private dirty = false

  constructor(private readonly uv: BufferAttribute, private readonly morphs: readonly PmxObject.Morph[]) {
    this.base = Float32Array.from(uv.array)
  }

  apply(weights: readonly number[]): void {
    const active = this.morphs.some((morph, i) => morph.type === 3 && weights[i] !== undefined && weights[i] !== 0)
    if (!active && !this.dirty)
      return
    this.uv.copyArray(this.base)
    this.uv.clearUpdateRanges()
    const vertices = new Set<number>()
    this.morphs.forEach((morph, i) => {
      if (morph.type !== 3)
        return
      morph.indices.forEach((vertex, j) => {
        vertices.add(vertex)
        const weight = weights[i] ?? 0
        this.uv.setXY(vertex, this.uv.getX(vertex) + weight * morph.offsets[j * 4], this.uv.getY(vertex) + weight * morph.offsets[j * 4 + 1])
      })
    })
    for (const vertex of vertices)
      this.uv.addUpdateRange(vertex * 2, 2)
    this.uv.needsUpdate = true
    this.dirty = active
  }

  resetToBase(): void {
    this.apply([])
  }
}
