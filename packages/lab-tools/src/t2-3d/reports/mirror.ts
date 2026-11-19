export const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, x, i) => s + x * b[i], 0)

/**
 * Consensus sides (E/g3/s/rules.md, candidate e2): +1 or -1 per item from the top eigenvector (power iteration) of
 * `gram`, the Gram matrix of the items' antisymmetric parts, so that the items marked -1, once mirrored, lean to the same
 * side as the others. The largest entry is +1. Items with no antisymmetric part all keep +1.
 */
export function consensusSides(gram: readonly (readonly number[])[]): number[] {
  let x = gram.map((_, i) => 1 + i * 1e-3)
  for (let iteration = 0; iteration < 100; iteration++) {
    const y = gram.map(row => dot(row, x))
    const length = Math.sqrt(dot(y, y))
    if (length < 1e-18)
      return x.map(() => 1)
    x = y.map(v => v / length)
  }
  const anchor = x.reduce((best, v) => Math.abs(v) > Math.abs(best) ? v : best, 0)
  return x.map(v => (v === 0 ? 1 : Math.sign(v)) * (anchor < 0 ? -1 : 1))
}
