import type { MotionScenarioClass } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DetectorParameters, MetricResult } from '../metrics'
import type { MetricPolicy } from './policy'
import type { MeasuredReference } from './reference-measure'
import type { ClassBands, HoldoutVerdict, MetricBand } from './types'

import { mean, median } from '../metrics/math'
import { fitBand, fitEpisodeBand, passesBand } from './bands'
import { judgeMetrics } from './judge'
import { declaredBands, metricPolicies, reportBand } from './policy'

function poolMeasurements(clip: MeasuredReference, scenario: MotionScenarioClass, policy: MetricPolicy): readonly MetricResult[] {
  return (clip.pools[scenario] ?? []).filter(m => m.id === policy.id)
}

function inPool(clip: MeasuredReference, policy: MetricPolicy): boolean {
  if (policy.id.startsWith('gaze.') || policy.id.startsWith('onset.') || policy.id === 'smooth.head.ldlj')
    return ['idle', 'talk'].includes(clip.entry.class)
  if (policy.id.startsWith('smooth.arm'))
    return clip.entry.class === 'talk'
  return clip.entry.class === 'walk'
}

export function fitClass(clips: readonly MeasuredReference[], scenario: MotionScenarioClass, parameters: DetectorParameters, emotionLower: number | null): ClassBands {
  const metrics: Record<string, MetricBand> = {}
  const holdout: HoldoutVerdict[] = []
  for (const policy of metricPolicies(scenario)) {
    if (!policy.fit) {
      metrics[policy.id] = reportBand(policy)
      continue
    }
    if (policy.unit === 'clip') {
      const fit = clips.filter(c => c.entry.class === scenario && c.entry.split === 'fit' && c.entry.role === 'window')
      const values = fit.flatMap(c => c.metrics.filter(m => m.id === policy.id && m.status === 'ok' && m.value !== null).flatMap(m => m.value === null ? [] : [m.value]))
      metrics[policy.id] = fitBand(values, policy)
      continue
    }
    const pools: { fit: number[], holdout: number[], subjects: Record<string, number> } = { fit: [], holdout: [], subjects: {} }
    const heldoutSubjects: Record<string, number> = {}
    for (const clip of clips.filter(c => inPool(c, policy))) {
      const samples = poolMeasurements(clip, scenario, policy).find(m => m.id === policy.id)?.samples ?? []
      const values = [...samples].sort((a, b) => a.start - b.start || a.end - b.end).map(s => s.value)
      pools[clip.entry.split].push(...values)
      if (clip.entry.split === 'fit')
        pools.subjects[clip.entry.subject] = (pools.subjects[clip.entry.subject] ?? 0) + values.length
      else
        heldoutSubjects[clip.entry.subject] = (heldoutSubjects[clip.entry.subject] ?? 0) + values.length
    }
    const rate = policy.id === 'gaze.orderRate' || policy.id === 'onset.easedOrAnticipated'
    const band = fitEpisodeBand(pools, policy, rate)
    metrics[policy.id] = { ...band, heldoutEpisodeCounts: heldoutSubjects }
    if (band.status === 'GATED') {
      for (let start = 0; start + 8 <= pools.holdout.length; start += 8) {
        const value = (rate ? mean : median)(pools.holdout.slice(start, start + 8))
        const pass = passesBand(value, band)
        holdout.push({ group: start / 8, metric: policy.id, value, verdict: pass ? 'PASS' : 'FAIL', failed: pass ? [] : [policy.id] })
      }
    }
  }
  Object.assign(metrics, declaredBands(scenario, emotionLower))
  const ownFit = clips.filter(c => c.entry.class === scenario && c.entry.split === 'fit' && c.entry.role === 'window')
  const window = { seconds: scenario === 'talk' ? 5 : 10, hopSeconds: scenario === 'talk' ? 2.5 : 5 }
  const classBands: ClassBands = {
    ...parameters,
    window,
    fit: ownFit.map(c => ({ clipSha256: c.clipSha256, dataset: c.entry.dataset, subject: c.entry.subject, seconds: c.seconds, hasFingers: c.hasFingers })),
    holdout,
    metrics,
  }
  for (const clip of clips.filter(c => c.entry.class === scenario && c.entry.split === 'holdout' && c.entry.role === 'window')) {
    // Episode metrics are validated by their prescribed groups of eight, never short clip medians.
    const eligible = clip.metrics.filter(m => metrics[m.id]?.unit !== 'episode')
    const judged = judgeMetrics(eligible, classBands)
    const failed = judged.filter(m => m.status === 'FAIL').map(m => m.id)
    if (!failed.length && !judged.some(m => m.status === 'PASS'))
      failed.push('no-gated-metrics')
    const values = Object.fromEntries(judged.filter(m => m.band?.status === 'GATED').map(m => [m.id, m.value]))
    holdout.push({ clipSha256: clip.clipSha256, dataset: clip.entry.dataset, subject: clip.entry.subject, verdict: failed.length ? 'FAIL' : 'PASS', failed, values })
  }
  return classBands
}
