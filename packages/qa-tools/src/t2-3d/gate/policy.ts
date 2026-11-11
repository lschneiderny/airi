import type { MotionScenarioClass } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { BandRule, ClassBands, MetricBand, Side } from './types'

import { CHAIN_PAIRS, SIGNAL_BONES } from '../metrics/bones'

export interface MetricPolicy extends BandRule {
  readonly id: string
  readonly fit: boolean
  readonly reason: string
}

export function metricPolicies(scenario: MotionScenarioClass): MetricPolicy[] {
  const policies: MetricPolicy[] = []
  const add = (id: string, side: Side, domain: BandRule['domain'], unit: BandRule['unit'] = 'clip', reason = '') => {
    const correlation = id.endsWith('zeroLagCorr') || id.startsWith('bilateral.') || id.endsWith('acfPeak') || id === 'gait.chestCounter'
    policies.push({ id, side, domain, unit, transform: correlation ? 'fisher-z' : 'none', fit: !reason, reason })
  }
  const coreReason = ['gaze', 'emotion', 'react'].includes(scenario) ? 'no reference class for core metrics in this scenario' : ''
  for (const pair of CHAIN_PAIRS) {
    add(`chain.${pair.join('-')}.zeroLagCorr`, 'upper', [0, 1], 'clip', coreReason)
    add(`chain.${pair.join('-')}.lagMs`, 'lower', [0, 500], 'clip', coreReason)
  }
  for (const signal of ['rootLateral', 'rootForeAft', 'rootVertical', ...SIGNAL_BONES]) {
    add(`spectral.${signal}.peakShare`, 'upper', [0, 1], 'clip', 'short reference clips cannot fit 30 s spectral segments')
    add(`spectral.${signal}.entropy`, 'lower', [0, 1], 'clip', 'short reference clips cannot fit 30 s spectral segments')
    add(`period.${signal}.acfPeak`, 'upper', [0, 1], 'clip', scenario === 'idle' ? '' : 'ACF fitted only for idle')
  }
  for (const id of ['coverage.core', 'coverage.arms'])
    add(id, 'lower', [0, 1], 'clip', coreReason)
  for (const joint of ['shoulder', 'upperArm', 'lowerArm', 'hand'])
    add(`bilateral.${joint}.peakCorr`, 'upper', [0, 1], 'clip', coreReason)
  for (const region of ['head', 'armL', 'armR']) {
    const reason = region === 'head' ? !['idle', 'talk'].includes(scenario) : scenario !== 'talk'
    add(`smooth.${region}.ldlj`, 'two', [null, null], 'episode', reason ? 'head pool uses idle and talk; arm pools use talk' : '')
    add(`smooth.${region}.spikeRate`, 'upper', [0, null], 'clip', coreReason)
  }
  for (const key of ['speedCv', 'holdFraction', 'movesPerMin'])
    add(`inter.${key}`, 'two', [0, key === 'holdFraction' ? 1 : null], 'clip', coreReason)
  for (const key of ['burstCv', 'moveDurationCv', 'head.top10PathShare'])
    add(`inter.${key}`, 'two', [0, null], 'clip', 'no long reference for this whole-trace statistic')
  for (const key of ['upper', 'core'])
    add(`dim.${key}`, 'lower', [1, key === 'upper' ? 39 : 51], 'clip', coreReason)
  if (scenario === 'gaze') {
    for (const key of ['chestLagMs', 'orderRate', 'overshootPct', 'settleMs'])
      add(`gaze.${key}`, key === 'orderRate' ? 'lower' : 'two', key === 'orderRate' ? [0, 1] : key === 'chestLagMs' ? [-2000, 2000] : [0, null], 'episode')
  }
  if (scenario === 'talk') {
    add('gesture.strokesPerMin', 'two', [0, null])
    for (const key of ['strokeGain', 'headGain'])
      add(`gesture.${key}`, 'lower', [null, null], 'clip', 'reference clips contain no audio')
  }
  if (scenario === 'emotion')
    add('emotion.medianSeparation', 'lower', [0, null], 'clip', 'reference clips contain no emotion trials')
  if (['gaze', 'talk', 'emotion', 'react'].includes(scenario)) {
    add('onset.attackFraction', 'two', [0, 1], 'episode', scenario === 'react' ? 'touch is report only' : '')
    add('onset.easedOrAnticipated', 'lower', [0, 1], 'episode', scenario === 'react' ? 'touch is report only' : '')
    add('onset.anticipationRate', 'lower', [0, 1], 'episode', 'anticipation is diagnostic only')
  }
  if (scenario === 'walk') {
    for (const [key, side, domain] of [
      ['pelvisTwistDeg', 'lower', [0, null]],
      ['chestCounter', 'upper', [-1, 1]],
      ['armSwingLagMs', 'lower', [-250, 250]],
      ['heelStrikePitchDeg', 'lower', [-90, 90]],
      ['toeOffPitchDeg', 'upper', [-90, 90]],
      ['headLeadMs', 'lower', [null, null]],
    ] as const)
      add(`gait.${key}`, side, domain, key === 'headLeadMs' ? 'episode' : 'clip')
  }
  if (scenario === 'idle') {
    for (const key of ['actsPerMin', 'regionEntropy', 'intervalCv'])
      add(`idle.${key}`, key === 'regionEntropy' ? 'lower' : 'two', [0, key === 'regionEntropy' ? 1 : null], 'clip', 'short idle clips cannot fit act statistics')
  }
  return policies
}

const MIRRORED_SIDES: Readonly<Record<string, string>> = { left: 'right', right: 'left', armL: 'armR', armR: 'armL' }

/** The same metric id or bone name on the other body side, or null when it names no side. */
export function mirroredName(id: string): string | null {
  const mirrored = id.replace(/left|right|armL|armR/g, side => MIRRORED_SIDES[side])
  return mirrored === id ? null : mirrored
}

/**
 * Version 2 fits a sided metric from both sides pooled whenever its mirror is
 * also fitted, so one performer's handedness cannot become a one-sided limit.
 * Returns the ids that share one band, in policy order (left first).
 */
export function sideGroup(policy: MetricPolicy, policies: readonly MetricPolicy[]): readonly string[] {
  const mirror = mirroredName(policy.id)
  return policies.filter(p => p.fit && (p.id === policy.id || p.id === mirror)).map(p => p.id)
}

export const STANDING_SPEAKER = {
  rule: 'In the talk class, every gated band fitted per clip from the talk window clips becomes REPORT. Those windows and their activity floors come from talk reference performers who locomote. The values are still measured and printed; the fitted bounds stay in the file.',
  reason: 'talk reference performers locomote; floors are not valid for a standing speaker',
  source: 'User decision, 2026-11-11: "Speech gate: Rules now, reference later (Recommended)".',
} as const

export const CLEAR_OF_NEUTRAL = {
  rule: 'min over every emotion other than neutral of its separation from neutral and from placebo >= 2; neutral against placebo excluded',
  reason: 'neutral has no posture, so neutral against placebo cannot separate; emotion.minSeparationFromNeutral gates instead',
  source: 'User decision, 2026-11-11: "Emotion gate: Clear of neutral (Recommended)". Threshold 2 is the declared bar of emotion.minSeparation, not fitted from human data.',
} as const

/**
 * Version 3 reports the talk class's clip-unit fitted bands instead of gating them. Episode
 * bands, declared bands, detector parameters and held-out verdicts are kept as fitted, and
 * every other class is returned unchanged.
 */
export function reportStandingSpeaker(scenario: MotionScenarioClass, c: ClassBands): ClassBands {
  if (scenario !== 'talk')
    return c
  const metrics = Object.fromEntries(Object.entries(c.metrics).map(([id, band]) => [
    id,
    band.basis === 'fitted' && band.unit === 'clip' && band.status === 'GATED' ? { ...band, status: 'REPORT', detail: STANDING_SPEAKER.reason } satisfies MetricBand : band,
  ] as const))
  return { ...c, metrics }
}

export function reportBand(policy: MetricPolicy): MetricBand {
  const { side, domain, transform, unit } = policy
  return { side, domain, transform, unit, basis: 'fitted', status: 'REPORT', detail: policy.reason, n: 0, p5: null, p50: null, p95: null, lo: null, hi: null }
}

export function declaredBands(scenario: MotionScenarioClass, emotionArmShare: number | null): Record<string, MetricBand> {
  const bands: Record<string, MetricBand> = {}
  const add = (id: string, lo: number | null, hi: number | null, rule: string, source: string, exclusiveHi = false) => {
    bands[id] = { side: lo === null ? 'upper' : hi === null ? 'lower' : 'two', domain: [null, null], transform: 'none', unit: id.startsWith('gaze.') ? 'episode' : 'clip', basis: 'declared', status: 'GATED', detail: '', n: 0, p5: null, p50: null, p95: null, lo, hi, rule, source, exclusiveHi }
  }
  if (scenario === 'idle') {
    for (const name of ['head', 'rootForeAft', 'rootLateral'])
      add(`period.${name}.loopPeak`, null, 0.3, 'loopPeak < 0.3', name === 'head' ? 'Live2D liveliness.ts:392-393; two desk sessions 0.041 and 0.023' : 'Live2D loop rule transferred to root; published broadband standing sway (design reference-sources.md:42)', true)
  }
  if (['idle', 'talk', 'walk'].includes(scenario)) {
    add('coverage.fingers', 0.5, null, 'median active-wrist finger coverage >= 0.5 at 0.1 * wrist activity', 'Lead design decision; no finger reference dataset')
    add('fingers.frozen', 0, 0, 'every-finger frozen indicator must equal 0; skipped without finger bones', 'Lead decision: a hand whose every finger is constant for a whole trace is a defect by construction')
  }
  if (scenario === 'gaze')
    add('gaze.eyeLeadMs', 0, null, 'eyeLeadMs >= 0', 'Eyes typically lead the head by 25 to 40 ms; design reference-sources.md:40')
  if (scenario === 'talk') {
    add('gesture.strokeP', null, 0.01, 'binomial tail <= 0.01', 'Lead design decision; gesture/prosody coupling timescale about 200 ms')
    add('gesture.strokeLagMs', -200, 200, '-200 <= nearest-hit strokeLagMs <= 200; no hit fails undefined: no-motion', 'Lead design decision; design reference-sources.md:43')
  }
  if (scenario === 'emotion') {
    add('emotion.minSeparation', 2, null, 'min pair separation including every emotion against placebo >= 2', 'Lead decision: detectable above trial noise, as in the Live2D emotion gate')
    bands['emotion.minSeparation'] = { ...bands['emotion.minSeparation'], status: 'REPORT', detail: CLEAR_OF_NEUTRAL.reason }
    add('emotion.minSeparationFromNeutral', 2, null, CLEAR_OF_NEUTRAL.rule, CLEAR_OF_NEUTRAL.source)
    add('emotion.armShare', emotionArmShare, null, 'armShare >= half the smallest of four 100STYLE emotion-style arm shares, only on a shared skeleton', 'Lead design decision; four 100STYLE styled standing clips')
    if (emotionArmShare === null)
      bands['emotion.armShare'] = { ...bands['emotion.armShare'], side: 'lower', status: 'REPORT', detail: 'emotion styles do not share a skeleton or posture context is unavailable' }
  }
  return bands
}
