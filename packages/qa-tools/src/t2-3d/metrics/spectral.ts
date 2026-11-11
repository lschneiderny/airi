import type { MetricResult, PreparedTrace } from './types'

import { SIGNAL_BONES } from './bones'
import { finite, mean, sum } from './math'
import { projection, scalarSignals } from './period'
import { result, skipped } from './result'

/** M2: 30 s Hann Welch, hop 15 s, bins 2..90. Five-bin peak share and normalised entropy (unitless). */
export function spectralEstimate(x: readonly number[]): { peakShare: number, entropy: number } | null {
  const power = Array.from<number>({ length: 89 }).fill(0)
  const n = 1800
  for (let start = 0; start + n <= x.length; start += 900) {
    const samples = x.slice(start, start + n)
    const m = mean(samples)
    const tapered = samples.map((v, i) => (v - m) * 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))))
    for (let k = 2; k <= 90; k++) {
      let real = 0
      let imag = 0
      for (let i = 0; i < n; i++) {
        real += tapered[i] * Math.cos(2 * Math.PI * k * i / n)
        imag -= tapered[i] * Math.sin(2 * Math.PI * k * i / n)
      }
      power[k - 2] = finite(power[k - 2] + (real * real + imag * imag), 'spectral energy')
    }
  }
  const total = sum(power)
  if (total < 1e-18)
    return null
  return {
    peakShare: finite(Math.max(...power.map((_, i) => sum(power.slice(Math.max(0, i - 2), i + 3)))) / total, 'spectral peak share'),
    entropy: finite(-power.reduce((s, v) => v > 0 ? s + v / total * Math.log(v / total) : s, 0) / Math.log(89), 'spectral entropy'),
  }
}

export function spectralMetrics(p: PreparedTrace): MetricResult[] {
  const signals = scalarSignals(p)
  return ['rootLateral', 'rootForeAft', 'rootVertical', ...SIGNAL_BONES].flatMap((name) => {
    const v = signals.get(name)
    const x = v ? name.startsWith('root') ? v.map(a => a[0]) : projection(v) : null
    const estimate = x && x.length >= 3600 ? spectralEstimate(x) : null
    return (['peakShare', 'entropy'] as const).map((key) => {
      const id = `spectral.${name}.${key}`
      if (!v)
        return skipped(id, 'fraction', 'trace', `bone-absent ${name}`)
      if (p.rootVelocity.length < 3600)
        return skipped(id, 'fraction', 'trace', 'insufficient-duration')
      return result(id, 'fraction', 'trace', estimate?.[key] ?? null, 'ok', 'report-only diagnostic')
    })
  })
}
