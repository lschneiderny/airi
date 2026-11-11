import type { ClassBands, HoldoutVerdict, MetricBand } from './types'

export const HOLDOUT_VALIDATION = {
  reportAtFailures: 2,
  isolatedFailuresAllowed: 1,
  source: 'Lead decision, 2026-11-11',
  timing: 'Set after seeing held-out results and before any character trace was judged.',
} as const

/** A clip or a consecutive episode group counts once for the metric it failed. */
export function heldoutFailureUnits(c: ClassBands, id: string): readonly HoldoutVerdict[] {
  const band = c.metrics[id]
  return c.holdout.filter(h => h.failed.includes(id) && (band.unit === 'clip' ? !!h.clipSha256 : h.metric === id))
}

/** Preserve raw held-out verdicts and all numeric bounds; declared rules never change. */
export function applyHoldoutRule(c: ClassBands): ClassBands {
  const metrics = Object.fromEntries(Object.entries(c.metrics).map(([id, band]) => {
    const failures = heldoutFailureUnits(c, id).length
    const updated: MetricBand = band.basis === 'fitted' && failures >= HOLDOUT_VALIDATION.reportAtFailures
      ? { ...band, status: 'REPORT', detail: `holdout-failures: ${failures}` }
      : band
    return [id, updated] as const
  }))
  return { ...c, metrics }
}
