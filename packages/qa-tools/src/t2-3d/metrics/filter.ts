import type { Vec3 } from './types'

import { finite } from './math'

/** Section 3.1 P7: forward/backward second-order Butterworth, 30-sample odd padding. */
export function butterworth(x: readonly number[], cutoff: number): number[] {
  for (const value of x)
    finite(value, 'filter input')
  finite(cutoff, 'filter cutoff')
  if (x.length < 2)
    return [...x]
  const k = Math.tan(Math.PI * cutoff / 60)
  const n = 1 / (1 + Math.SQRT2 * k + k * k)
  const b0 = k * k * n
  const a1 = 2 * (k * k - 1) * n
  const a2 = (1 - Math.SQRT2 * k + k * k) * n
  const pad = 30
  function reflected(i: number): number {
    if (i < 0)
      return finite(2 * x[0] - reflected(-i), 'filter reflection')
    if (i >= x.length)
      return finite(2 * x[x.length - 1] - reflected(2 * (x.length - 1) - i), 'filter reflection')
    return x[i]
  }
  const padded = [
    ...Array.from({ length: pad }, (_, i) => reflected(i - pad)),
    ...x,
    ...Array.from({ length: pad }, (_, i) => reflected(x.length + i)),
  ]
  function pass(values: readonly number[]): number[] {
    // Constant steady-state initial conditions preserve DC, including at the padded boundary.
    let x1 = values[0]
    let x2 = values[0]
    let y1 = values[0]
    let y2 = values[0]
    return values.map((v) => {
      const y = finite(b0 * (v + 2 * x1 + x2) - a1 * y1 - a2 * y2, 'filter recurrence')
      x2 = x1
      x1 = v
      y2 = y1
      y1 = y
      return y
    })
  }
  return pass(pass(padded).reverse()).reverse().slice(pad, pad + x.length)
}

export function filterVectors(x: readonly Vec3[], cutoff: number): Vec3[] {
  const components = [0, 1, 2].map(i => butterworth(x.map(v => v[i]), cutoff))
  return x.map((_, i) => [components[0][i], components[1][i], components[2][i]])
}
