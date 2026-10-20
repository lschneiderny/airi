/**
 * One-sample Kolmogorov-Smirnov test against the uniform distribution on [0, 1], without dependencies.
 * The scorer validation uses it to check that idle p-values are uniform.
 */

/** Two-sided statistic `D = sup |F_n(x) - x|` of `values` against U(0, 1). */
export function ksStatisticUniform(values: readonly number[]): number {
  if (!values.length)
    throw new Error('[qa-tools] The KS statistic needs at least one value')
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  let d = 0
  sorted.forEach((value, index) => {
    const x = Math.min(1, Math.max(0, value))
    d = Math.max(d, (index + 1) / n - x, x - index / n)
  })
  return d
}

function multiply(a: Float64Array, b: Float64Array, m: number): Float64Array {
  const c = new Float64Array(m * m)
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < m; k++) {
      const left = a[i * m + k]
      if (left === 0)
        continue
      for (let j = 0; j < m; j++)
        c[i * m + j] += left * b[k * m + j]
    }
  }
  return c
}

/** `A^n` with a decimal exponent kept aside, so large powers do not overflow (Marsaglia, Tsang and Wang 2003). */
function power(a: Float64Array, m: number, n: number): { value: Float64Array, exponent: number } {
  if (n === 1)
    return { value: a, exponent: 0 }
  const half = power(a, m, Math.floor(n / 2))
  let value = multiply(half.value, half.value, m)
  let exponent = 2 * half.exponent
  if (n % 2 === 1)
    value = multiply(a, value, m)
  const center = Math.floor(m / 2)
  if (value[center * m + center] > 1e140) {
    for (let index = 0; index < value.length; index++)
      value[index] *= 1e-140
    exponent += 140
  }
  return { value, exponent }
}

/**
 * Exact CDF `P(D_n < d)` of the two-sided one-sample KS statistic, by the Marsaglia-Tsang-Wang matrix method
 * ("Evaluating Kolmogorov's Distribution", Journal of Statistical Software 8(18), 2003), including the
 * paper's published shortcut for the far upper tail, which is accurate to about 7 digits there.
 */
export function kolmogorovCdf(n: number, d: number): number {
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`[qa-tools] The KS sample size must be a positive integer, got ${n}`)
  if (d <= 0)
    return 0
  if (d >= 1)
    return 1
  const s = d * d * n
  if (s > 7.24 || (s > 3.76 && n > 99))
    return 1 - 2 * Math.exp(-(2.000071 + 0.331 / Math.sqrt(n) + 1.409 / n) * s)
  const k = Math.floor(n * d) + 1
  const m = 2 * k - 1
  const h = k - n * d
  const matrix = new Float64Array(m * m)
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++)
      matrix[i * m + j] = i - j + 1 < 0 ? 0 : 1
  }
  for (let i = 0; i < m; i++) {
    matrix[i * m] -= h ** (i + 1)
    matrix[(m - 1) * m + i] -= h ** (m - i)
  }
  matrix[(m - 1) * m] += 2 * h - 1 > 0 ? (2 * h - 1) ** m : 0
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      for (let g = 1; g <= i - j + 1; g++)
        matrix[i * m + j] /= g
    }
  }
  const { value, exponent } = power(matrix, m, n)
  let result = value[(k - 1) * m + k - 1]
  let scale = exponent
  for (let i = 1; i <= n; i++) {
    result = result * i / n
    if (result < 1e-140) {
      result *= 1e140
      scale -= 140
    }
  }
  return result * 10 ** scale
}

export interface KsResult {
  n: number
  d: number
  /** `P(D_n >= d)` under uniformity. */
  p: number
}

/** Two-sided one-sample KS test of `values` against U(0, 1). */
export function ksTestUniform(values: readonly number[]): KsResult {
  const d = ksStatisticUniform(values)
  return { n: values.length, d, p: Math.min(1, Math.max(0, 1 - kolmogorovCdf(values.length, d))) }
}
