import type { PmxObject } from '@moeru/three-mmd'

/** Compile group edges once. Vertex children are already baked by three-mmd. */
export function createMorphExpansion(morphs: readonly PmxObject.Morph[]) {
  const edges: { parent: number, child: number, ratio: number }[] = []
  const warned = new Set<string>()
  function warn(kind: string) {
    if (warned.has(kind))
      return
    warned.add(kind)
    console.warn('MMD morph runtime: unsupported morph data', kind)
  }
  morphs.forEach((morph, parent) => {
    switch (morph.type) {
      case 0:
        morph.indices.forEach((child, i) => {
          const target = morphs[child]
          if (!target) {
            warn('invalid group index')
            return
          }
          if (target.type === 0) {
            warn('nested group')
            return
          }
          if (target.type === 2 || target.type === 3 || target.type === 8)
            edges.push({ parent, child, ratio: morph.ratios[i] })
        })
        break
      case 9:
      case 10:
        warn(`type ${morph.type}`)
        break
      case 4:
      case 5:
      case 6:
      case 7:
        warn('additional UV')
        break
    }
  })
  return (requested: readonly number[]): number[] => {
    const effective = morphs.map((morph, i) => (morph.type >= 4 && morph.type <= 7) || morph.type >= 9 ? 0 : requested[i] ?? 0)
    for (const edge of edges)
      effective[edge.child] += (requested[edge.parent] ?? 0) * edge.ratio
    return effective
  }
}
