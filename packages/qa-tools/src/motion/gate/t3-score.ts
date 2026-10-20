import type { Band, ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { ChannelCheck, CheckResult, EmotionGate, EmotionTrialRecord, PlaceboRecord, ScoredChannel } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import type { EmotionT3Gate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import type { ParameterRanges } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/liveliness'
import type { NaturalTrace } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'

import { fitExponential, measureEmotionTrial, measurePlacebos, releaseGrid, releaseTrajectory, scoredChannels, scoreEmotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import { buildEmotionChecks } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'

/**
 * T3 scoring. Measurement and statistics come from the shared scorer (`emotion-score.ts`): the same
 * `measureEmotionTrial`, `measurePlacebos` and `scoreEmotionGate` the T1 and T2 gates call, here with no stripped run, so
 * every trial is scored unpaired against the session's placebo windows. This module only applies the T3 rules of
 * `naturalEmotionT3Gate` to the scorer's numbers.
 */

/** Unpaired release trajectories of one T3 pulse, per face and eyelid channel (`releaseTrajectory`, on `releaseGrid`). */
export interface T3ReleaseRecord {
  trialId: string
  emotion: PerformanceEmotion
  band: Band
  side: -1 | 1 | null
  channels: Partial<Record<ScoredChannel, number[]>>
}

export interface T3SessionMeasures {
  records: EmotionTrialRecord[]
  placebos: PlaceboRecord[]
  release: T3ReleaseRecord[]
}

const releaseChannels = (Object.keys(scoredChannels) as ScoredChannel[]).filter(channel => scoredChannels[channel] === 'face' || scoredChannels[channel] === 'eyelid')

/** Measures every pulse and placebo of one rendered session trace. `trialIds` are the scenario's emotion trial ids. */
export function measureT3Session(trace: NaturalTrace, trialIds: readonly string[], gate: EmotionGate, settings: ExpressionPerformanceSettings): T3SessionMeasures {
  const records = trialIds.map(trialId => measureEmotionTrial(trace, null, { trialId, variant: 'full', gate, settings }))
  const release = records.map((record): T3ReleaseRecord => {
    const pulse = trace.events.find(entry => entry.source === 'scenario' && entry.event.kind === 'emotion' && entry.event.trialId === record.trialId)!.t
    const channels: T3ReleaseRecord['channels'] = {}
    for (const channel of releaseChannels) {
      const trajectory = releaseTrajectory(trace, channel, pulse, gate)
      if (Array.isArray(trajectory))
        channels[channel] = trajectory
    }
    return { trialId: record.trialId, emotion: record.emotion, band: record.band, side: record.side, channels }
  })
  return { records, placebos: measurePlacebos(trace, gate), release }
}

/** `E_T3 / E_T1`, or `null` when either effect is missing or the T1 effect is zero. */
export function t3TransferRatio(t3: number | null | undefined, t1: number | null | undefined): number | null {
  if (typeof t3 !== 'number' || typeof t1 !== 'number' || !Number.isFinite(t3) || !Number.isFinite(t1) || Math.abs(t1) < 1e-12)
    return null
  return t3 / t1
}

export type T3Criterion = 'visibility' | 'transfer' | 'release'

export interface T3CheckResult extends Omit<CheckResult, 'verdict' | 'failed'> {
  verdict: 'pass' | 'fail' | 'n/a'
  /** Face and eyelid checks are gated; posture is reported only. */
  gated: boolean
  failed: T3Criterion[]
  /** The T1 effect of the same check, from the reference report. */
  t1E: number | null
  transferRatio: number | null
  /** The shared scorer's own verdict with its T1 thresholds, for reference only. */
  scorer: { verdict: CheckResult['verdict'], failed: CheckResult['failed'] }
}

export interface T3PosturePool {
  channel: ScoredChannel
  checks: number
  /** Checks whose unpaired effect points in the recipe direction. */
  signAgrees: number
  /** Mean `d = E / sigma0` over the pooled checks. */
  meanD: number | null
}

export interface T3EmotionScore {
  results: T3CheckResult[]
  nullStats: Record<string, { sigma0: number, q: number, n: number }>
  posture: T3PosturePool[]
  pass: boolean
}

export interface T3ScoreInput {
  t3: EmotionT3Gate
  gate: EmotionGate
  records: readonly EmotionTrialRecord[]
  placebos: readonly PlaceboRecord[]
  release: readonly T3ReleaseRecord[]
  ranges: ParameterRanges
  settings: ExpressionPerformanceSettings
  /** `E` per check key from the T1 reference report at the same commit. */
  t1Effects: ReadonlyMap<string, number | null>
}

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

/** Gross release check: the fitted tau of the direction-folded mean unpaired trajectory must not exceed the multiple of the nominal tau. */
function grossRelease(check: ChannelCheck, input: T3ScoreInput, result: CheckResult): { outcome: boolean | null, tau: number | null, reason: string | null } {
  const rejected = new Set(input.records.filter(record => record.rejected !== null).map(record => record.trialId))
  const usable = input.release.filter(record => record.emotion === check.emotion && record.band === check.band && !rejected.has(record.trialId) && record.channels[check.channel])
  const folded = usable.flatMap((record) => {
    const sign = check.sign * (check.sided ? record.side ?? 0 : 1)
    return sign === 0 ? [] : [record.channels[check.channel]!.map(value => sign * value)]
  })
  if (!folded.length)
    return { outcome: null, tau: null, reason: check.sided ? 'release: no trial with a known hold side' : 'release: no release trajectory' }
  if (typeof result.E !== 'number' || !(result.E > 0))
    return { outcome: null, tau: null, reason: 'release: no effect in the recipe direction to release' }
  const grid = releaseGrid(input.gate)
  const fit = fitExponential(grid, grid.map((_, point) => mean(folded.map(trajectory => trajectory[point]))), input.gate.release.window[0])
  if (!(fit.A > 0) || !Number.isFinite(fit.tau))
    return { outcome: null, tau: Number.isFinite(fit.tau) ? fit.tau : null, reason: `release: the mean trajectory has no decaying component (A ${fit.A})` }
  const limit = input.t3.releaseGrossTauMultiple * input.settings.held.releaseTau
  return { outcome: fit.tau <= limit, tau: fit.tau, reason: fit.tau <= limit ? null : `release: tau ${fit.tau} above ${input.t3.releaseGrossTauMultiple} x nominal ${input.settings.held.releaseTau}` }
}

/**
 * Scores the T3 cells: the shared scorer measures significance, sign and visibility unpaired (no stripped run), then
 * each face and eyelid check passes when at least `visibilityMinHits` trials beat the placebo q90, face channels have
 * `E_T3 / E_T1` within `transferRatio`, and the release is not grossly slow. A criterion without data is `n/a`, which
 * fails the gate. Posture checks are reported and pooled, never gated.
 */
export function scoreT3Emotion(input: T3ScoreInput): T3EmotionScore {
  const { t3 } = input
  // Slow modulation needs the long-hold variant, which a T3 session does not run.
  const checks = buildEmotionChecks().filter(check => check.cls !== 'modulation' && t3.cells.some(cell => cell.emotion === check.emotion && cell.band === check.band))
  const score = scoreEmotionGate({ gate: input.gate, checks, trials: input.records, placebos: input.placebos, ranges: input.ranges, settings: input.settings, criteria: ['significance', 'sign', 'visibility'] })
  const checksByKey = new Map(checks.map(check => [check.key, check]))

  const results = score.results.map((result): T3CheckResult => {
    const check = checksByKey.get(result.key)!
    const t1E = input.t1Effects.get(result.key) ?? null
    const transferRatio = check.cls === 'face' ? t3TransferRatio(result.E, t1E) : null
    const base = { ...result, t1E, transferRatio, scorer: { verdict: result.verdict, failed: result.failed }, reasons: [...result.reasons] }
    if (check.cls !== 'face' && check.cls !== 'eyelid')
      return { ...base, gated: false, verdict: 'n/a', failed: [], reasons: [...base.reasons, `${check.cls}: reported, not gated at T3`] }
    // A parameter the rig does not have cannot render, so its check says nothing about transfer; it is listed, not gated.
    const cellRecords = input.records.filter(record => record.emotion === check.emotion && record.band === check.band)
    if (cellRecords.length > 0 && cellRecords.every(record => record.missing[check.channel]?.startsWith('trace has no ')))
      return { ...base, gated: false, verdict: 'n/a', failed: [], reasons: [...base.reasons, `rig: ${cellRecords[0].missing[check.channel]}; not gated`] }

    const outcomes: Partial<Record<T3Criterion, boolean | null>> = {}
    const reasons = base.reasons
    outcomes.visibility = result.hits === null ? null : result.hits >= t3.visibilityMinHits
    if (result.hits === null)
      reasons.push('t3 visibility: no hit count')
    if (check.cls === 'face') {
      outcomes.transfer = transferRatio === null ? null : transferRatio >= t3.transferRatio[0] && transferRatio <= t3.transferRatio[1]
      if (transferRatio === null)
        reasons.push(t1E === null ? 't3 transfer: the T1 reference has no effect for this check' : 't3 transfer: no T3 effect')
      if (result.unsigned)
        reasons.push('t3 transfer: T3 is unsigned (no hold side), T1 is signed')
    }
    const release = grossRelease(check, input, result)
    outcomes.release = release.outcome
    if (release.reason)
      reasons.push(release.reason)
    const failed = (Object.keys(outcomes) as T3Criterion[]).filter(criterion => outcomes[criterion] === false)
    const incomplete = Object.values(outcomes).includes(null)
    return { ...base, tau: release.tau, gated: true, failed, verdict: failed.length ? 'fail' : incomplete ? 'n/a' : 'pass' }
  })

  const posture = new Map<ScoredChannel, T3CheckResult[]>()
  for (const result of results) {
    if (scoredChannels[result.channel] === 'posture')
      posture.set(result.channel, [...posture.get(result.channel) ?? [], result])
  }
  const gated = results.filter(result => result.gated)
  return {
    results,
    nullStats: score.nullStats as T3EmotionScore['nullStats'],
    posture: [...posture.entries()].map(([channel, entries]) => {
      const ds = entries.flatMap(entry => typeof entry.d === 'number' ? [entry.d] : [])
      return { channel, checks: entries.length, signAgrees: entries.filter(entry => typeof entry.E === 'number' && entry.E > 0).length, meanD: ds.length ? mean(ds) : null }
    }),
    pass: gated.length > 0 && gated.every(result => result.verdict === 'pass'),
  }
}
