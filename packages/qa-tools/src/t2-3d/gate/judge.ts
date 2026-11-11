import type { MetricResult } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'
import type { MotionBandsFile, MotionVerdict, VerdictMetric } from './types'

import { measureTrace, onsetMetrics, prepareTrace } from '../metrics'
import { passesBand } from './bands'
import { LIMITATION, motionQualityGate } from './definition'
import { headOnly } from './detectors'
import { definitionSha256 } from './load'
import { checkTrace } from './refusals'

export function judgeMetrics(measurements: readonly MetricResult[], bands: MotionBandsFile['classes'][keyof MotionBandsFile['classes']]): VerdictMetric[] {
  return measurements.map((metric) => {
    const band = bands?.metrics[metric.id] ?? null
    const gated = band?.status === 'GATED'
    const status = metric.status.startsWith('skipped:')
      ? 'SKIPPED'
      : !gated
          ? 'REPORT'
          : metric.value === null || !passesBand(metric.value, band)
            ? 'FAIL'
            : 'PASS'
    return { id: metric.id, family: metric.family, value: metric.value, unit: metric.unit, status, basis: band?.basis ?? null, band, detail: [metric.detail, band?.detail].filter(Boolean).join('; ') }
  })
}

export function judgeTrace(input: DecodedMotionTrace, bands: MotionBandsFile, identity: { readonly path: string, readonly sha256: string }, pooled?: { readonly measurements: readonly MetricResult[], readonly from: readonly string[] }): MotionVerdict {
  const timing = checkTrace(input, bands)
  const scenario = input.trace.source.scenario
  const classBands = bands.classes[scenario.class]
  // checkTrace establishes the presence of the class before any measurements.
  if (!classBands)
    throw new TypeError('Class bands were not established by checkTrace')
  let measurements = measureTrace(input, classBands)
  if (scenario.class === 'gaze') {
    const p = prepareTrace(input)
    const headOnsets = onsetMetrics(headOnly(p), classBands)
    measurements = [...measurements.filter(m => !m.id.startsWith('onset.')), ...headOnsets]
  }
  if (pooled)
    measurements = [...measurements.filter(m => !m.id.startsWith('emotion.')), ...pooled.measurements]
  const metrics = judgeMetrics(measurements, classBands)
  const counts = { pass: 0, fail: 0, report: 0, skipped: 0 }
  for (const m of metrics) {
    switch (m.status) {
      case 'PASS':
        counts.pass++
        break
      case 'FAIL':
        counts.fail++
        break
      case 'REPORT':
        counts.report++
        break
      case 'SKIPPED':
        counts.skipped++
        break
    }
  }
  const refusal = counts.fail === 0 && counts.pass === 0 ? { name: 'no-gated-metrics', detail: 'No applicable gated metric could be judged' } : null
  return {
    kind: 'mmd-motion-verdict',
    gate: { id: motionQualityGate.id, version: bands.gate.version, fileSha256: definitionSha256, bandsSha256: motionQualityGate.bandsSha256 },
    trace: { ...identity, level: input.trace.source.level, scenario: scenario.id, class: scenario.class, seed: scenario.seed, ...timing },
    verdict: counts.fail ? 'FAIL' : refusal ? 'REFUSED' : 'PASS',
    refusal,
    metrics,
    counts,
    ...(pooled ? { pooledFrom: pooled.from } : {}),
    limitation: LIMITATION,
  }
}

export function refusedVerdict(path: string, refusal: { readonly name: string, readonly detail: string }): MotionVerdict {
  return {
    kind: 'mmd-motion-verdict',
    gate: { id: motionQualityGate.id, version: motionQualityGate.version, fileSha256: definitionSha256, bandsSha256: motionQualityGate.bandsSha256 },
    trace: { path, sha256: '', level: null, scenario: null, class: null, seed: null, scoredSeconds: 0, hz: 0 },
    verdict: 'REFUSED',
    refusal,
    metrics: [],
    counts: { pass: 0, fail: 0, report: 0, skipped: 0 },
    limitation: LIMITATION,
  }
}

export function verdictExitCode(verdicts: readonly MotionVerdict[]): number {
  return verdicts.some(v => v.verdict === 'FAIL') ? 1 : !verdicts.length || verdicts.some(v => v.verdict === 'REFUSED') ? 2 : 0
}
