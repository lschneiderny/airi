import type { ClassBands, HoldoutVerdict, MetricBand } from './types'

import { mirroredName } from './policy'

export const HOLDOUT_VALIDATION = {
  reportAtFailures: 2,
  isolatedFailuresAllowed: 1,
  source: 'Lead decision, 2026-11-11',
  timing: 'Set after seeing held-out results and before any character trace was judged.',
} as const

/**
 * A clip or a consecutive episode group counts once for the metric it failed.
 * Mirrored sides share one band, so a clip counts once for each side that
 * fails it, and a pooled episode group counts once for the pair.
 */
export function heldoutFailureUnits(c: ClassBands, id: string): readonly HoldoutVerdict[] {
  const band = c.metrics[id]
  const mirror = mirroredName(id)
  const ids = mirror && c.metrics[mirror]?.basis === 'fitted' ? [id, mirror] : [id]
  if (band.unit === 'clip')
    return c.holdout.filter(h => !!h.clipSha256).flatMap(h => ids.filter(side => h.failed.includes(side)).map(() => h))
  return c.holdout.filter(h => h.metric !== undefined && ids.includes(h.metric) && h.failed.includes(h.metric))
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
