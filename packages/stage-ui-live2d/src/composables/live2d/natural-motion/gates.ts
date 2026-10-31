import type { HeldSpec, naturalEmotions as NaturalEmotionTable } from '@proj-airi/motion-driver-natural/emotions'
import type { Band, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { ChannelCheck, EmotionGate, ScoredChannel } from './emotion-score'
import type { MetricReference } from './liveliness'

import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'

import { scoredChannels } from './emotion-score'
import { generatedBlinkBands, generatedMouthOpenBand } from './liveliness'
import { referenceStats } from './reference-stats'

/**
 * Committed QA gates. Each gate is code with an `id` and an integer `version`: change a metric, threshold, window,
 * trial count, or seed rule only by editing this file, and bump `version` when you do. Reports record the git SHA of
 * this file, so a verdict always names the exact rules it was judged by. Run directories (qa-tools `RunGate`) store
 * the version as a string; convert with `String(gate.version)` at that boundary.
 */

export interface LivelinessGate {
  id: string
  version: number
  limitation: string
  /** Metrics that must pass; every other metric is reported only. */
  metrics: readonly string[]
  seeds: readonly number[]
  warmUpSeconds: number
  scoredSeconds: number
  /** The bands `scoreLiveliness` uses in generated mode. */
  bands: Readonly<Record<string, MetricReference>>
}

export interface TalkingGate {
  id: string
  version: number
  limitation: string
  seeds: readonly number[]
  warmUpSeconds: number
  scoredSeconds: number
  /** Inclusive band of talking over silent mean head speed. */
  speedRatio: readonly [min: number, max: number]
  /** Head speed in the 0.4 s after speech onsets over the same window 1.7 s later must exceed this. */
  onsetEnrichmentAbove: number
}

const livelinessLimitation = 'Liveliness scores compare idle motion statistics with the desk VTS reference bands. They do not prove naturalness, which stays a visual review, and the desk recordings are valid for idle liveliness only.'

/** The idle liveliness gate: the desk fixture simulated at 120 Hz, scored in generated mode. */
export const naturalIdleLivelinessGate = {
  id: 'natural-idle-liveliness',
  version: 1,
  limitation: livelinessLimitation,
  metrics: [
    'sd:ParamAngleX',
    'sd:ParamAngleY',
    'sd:ParamAngleZ',
    'still05',
    'still2',
    'top10PathShare',
    'velocityAcfCrossing',
    'loopPeak',
    'meanAngleY',
    'minuteAngleYRange',
    'angleXp5',
    'angleXp95',
    'jitter',
    'nearLimitOccupancy',
    // Shift-amplitude dispersion: spread rejects constant sizes; log asymmetry rejects the uniform sizes
    // [0.1, 0.5] and [0.15, 0.45] but not every tail-less spread.
    'speedPeakP90P50',
    'speedPeakLogAsymmetry',
    // Gaze layer: independent fixations with partial head counter-rotation.
    'sd:ParamEyeBallX',
    'sd:ParamEyeBallY',
    'eyeHeadCorrelation',
    // Face, blink, and breath layers. The loop detector scores head channels only, so ParamBreath stays periodic.
    // Generated scoring judges blink on `generatedBlinkBands`, not the recording bands.
    'blinkRate',
    'blinkCv',
    'sd:ParamBrowLY',
    'sd:ParamMouthForm',
  ],
  seeds: [1, 2, 3],
  warmUpSeconds: 3 * 60,
  scoredSeconds: 30 * 60,
  bands: { ...referenceStats.bands, ...generatedBlinkBands, ...generatedMouthOpenBand },
} as const satisfies LivelinessGate

/** Talking relative to silence on the same seed; the thresholds are the ones `scoreTalkingRelative` applies. */
export const naturalTalkingGate = {
  id: 'natural-talking',
  version: 1,
  limitation: livelinessLimitation,
  seeds: [1, 2, 3],
  warmUpSeconds: 60,
  scoredSeconds: 10 * 60,
  speedRatio: [1.15, 1.7],
  onsetEnrichmentAbove: 1.2,
} as const satisfies TalkingGate

/**
 * The emotion gate: paired counterfactual trials (same seed, emotions stripped) against an idle placebo null.
 * Full trials carry significance, sign, and visibility; held-only trials carry size and the face release;
 * long holds carry slow modulation and its release. See `emotion-score.ts` for every statistic.
 */
export const emotionGate = {
  id: 'natural-emotion',
  version: 1,
  limitation: 'Scores prove direction, size relative to the recipe, release, and detectability above the rig\'s idle noise. They do not prove naturalness, which stays a visual review.',
  scenario: { warmup: 20, hold: 4, post: 6, longHoldSeconds: 60, longHoldPost: 30, placeboSpacing: 6 },
  windows: { baseline: [-1, 0], face: [0.5, 3.5], eyelid: [0.5, 3.5], posture: [2, 4], modulation: [10, 60] },
  release: {
    window: [4, 10],
    late: [7, 9],
    modulationWindow: [10, 30],
    tauRatio: [0.5, 2],
    tauExcluded: 3,
    offsetShare: 0.1,
    lateEffectShare: 0.15,
    lateNoiseShare: 0.25,
    ratioTolerance: 0.05,
  },
  visibility: {
    quantile: 0.9,
    bands: {
      slight: { hitRate: 0.3, d: 0.5 },
      clear: { hitRate: 0.6, d: 1 },
      strong: { hitRate: 0.75, d: 1.5 },
    },
  },
  size: { ratio: [0.5, 1.5] },
  seeds: { full: { start: 1, count: 100 }, heldOnly: { start: 1, count: 30 }, longHold: { start: 1, count: 40 } },
  placeboPerNullRun: 10,
  family: { alpha: 0.01, method: 'holm', permutations: 1e5, bootstrap: 1000 },
  levels: ['t1', 't2'],
} as const satisfies EmotionGate

export interface EmotionT3Gate {
  id: string
  version: number
  limitation: string
  /** Emotion x band cells pulsed in the rendered app; each cell's checks come from `buildEmotionChecks`. */
  cells: readonly { emotion: PerformanceEmotion, band: Band }[]
  trialsPerCell: number
  /** Pulses are at least this far apart, and at least `naturalEmotionLifetime + lifetimeMarginSeconds`. */
  minSpacingSeconds: number
  lifetimeMarginSeconds: number
  /** Placebo windows of the session nulls, counted over every session. */
  minPlacebos: number
  /**
   * How trials meet the placebo null: `session-stratified` scores each trial against its own capture session's placebo
   * windows (visibility quantile, effect, stratified permutation test and bootstrap; `stratifiedUnpairedPValue`).
   */
  placeboNull: 'session-stratified'
  /** Longest scenario of one capture: the capture store stops at 600 s and the harness captures one second more. */
  maxSessionSeconds: number
  /** Fewest captures; every capture of a run has the same duration (the rendered-gate rule in the README). */
  minSessions: number
  /** Face and eyelid checks pass visibility with at least this many trials above the placebo q90. */
  visibilityMinHits: number
  /** Inclusive band of `E_T3 / E_T1` per face channel. */
  transferRatio: readonly [min: number, max: number]
  /** Release fails only for a gross regression: fitted tau above this multiple of the nominal `held.releaseTau`. */
  releaseGrossTauMultiple: number
}

/**
 * The rendered (T3) emotion transfer gate on one rig. Pulses are scored unpaired against the placebo windows of their
 * own capture session (session-stratified), with the windows and statistics of `emotionGate`; the T3 rules replace the
 * T1 thresholds: a
 * visibility hit count, the ratio of the T3 effect to the T1 effect at the same commit, and a gross release check.
 * Posture is reported, not gated.
 */
export const naturalEmotionT3Gate = {
  id: 'natural-emotion-t3',
  // v2: the placebo null is session-stratified instead of pooled over sessions.
  version: 2,
  limitation: emotionGate.limitation,
  cells: [{ emotion: 'angry', band: 'strong' }, { emotion: 'sad', band: 'clear' }, { emotion: 'love', band: 'clear' }, { emotion: 'sleepy', band: 'strong' }],
  trialsPerCell: 10,
  minSpacingSeconds: 12,
  lifetimeMarginSeconds: 4,
  minPlacebos: 50,
  placeboNull: 'session-stratified',
  maxSessionSeconds: 599,
  minSessions: 3,
  visibilityMinHits: 6,
  transferRatio: [0.7, 1.3],
  releaseGrossTauMultiple: 3,
} as const satisfies EmotionT3Gate

/**
 * Held recipe entries no scored channel measures. The scorer cannot see them in an idle trace, so they are
 * listed here instead of being silently skipped.
 */
export const unscoredRecipeEntries = {
  'modulation.deskWeight': 'Shifts gaze target weights toward the desk; no trace channel isolates target choice from posture.',
  'modulation.nodSize': 'Scales speech emphasis nods, which only exist while talking.',
  'modulation.nodAcceptance': 'Changes how many speech onsets become nods, which only exist while talking.',
} as const

const bands: readonly Band[] = ['slight', 'clear', 'strong']
/** Slow modulation needs a settled hold; slight is face-only recruitment and is not gated on it. */
const modulationBands: readonly Band[] = ['clear', 'strong']
const postureChannels: readonly (readonly [head: ScoredChannel, body: ScoredChannel])[] = [['angleX', 'bodyAngleX'], ['angleY', 'bodyAngleY'], ['angleZ', 'bodyAngleZ']]

function check(emotion: PerformanceEmotion, band: Band, channel: ScoredChannel, recipe: number, sided: boolean, extra: Partial<ChannelCheck> = {}): ChannelCheck {
  const direction = recipe + (extra.hint ?? 0)
  return { key: `${emotion}:${band}:${channel}`, emotion, band, channel, cls: scoredChannels[channel], sign: direction < 0 ? -1 : 1, sided, recipe, ...extra }
}

function emotionChecks(emotion: PerformanceEmotion, held: HeldSpec, band: Band): ChannelCheck[] {
  const { face, posture, sided, modulation } = held
  const oneSided = face.oneSidedBrow ?? 0
  const checks: ChannelCheck[] = []
  // Both brows rise by browY; a one-sided raise lifts their mean by half and their difference by half.
  if (face.browY !== 0 || oneSided !== 0)
    checks.push(check(emotion, band, 'browMean', face.browY + oneSided / 2, false))
  if (oneSided !== 0)
    checks.push(check(emotion, band, 'browAsym', oneSided / 2, true))
  for (const [channel, value] of [['browAngle', face.browAngle], ['eyeSmile', face.eyeSmile], ['mouthForm', face.mouthForm], ['mouthOpen', face.mouthOpen], ['cheek', face.cheek]] as const) {
    if (value !== 0)
      checks.push(check(emotion, band, channel, value, false))
  }
  if (face.eyeOpenMultiplier !== 1 || face.eyeOpenHint !== 0)
    checks.push(check(emotion, band, 'eyelid', face.eyeOpenMultiplier - 1, false, { hint: face.eyeOpenHint }))
  posture.forEach((value, axis) => {
    if (value === 0)
      return
    for (const channel of postureChannels[axis])
      checks.push(check(emotion, band, channel, value, sided.includes(axis as 0 | 1 | 2)))
  })
  if (modulationBands.includes(band)) {
    // Longer blink intervals lower the blink rate; the camera-fixation change is additive.
    if (modulation.blinkInterval !== 1)
      checks.push(check(emotion, band, 'blinkRate', modulation.blinkInterval - 1, false, { sign: modulation.blinkInterval > 1 ? -1 : 1 }))
    if (modulation.breathPeriod !== 1)
      checks.push(check(emotion, band, 'breathPeriod', modulation.breathPeriod - 1, false))
    if (modulation.amplitude !== 1)
      checks.push(check(emotion, band, 'headRms', modulation.amplitude - 1, false))
    if (modulation.cameraFixation !== 0)
      checks.push(check(emotion, band, 'cameraFixation', modulation.cameraFixation, false))
  }
  return checks
}

/**
 * Generates every `ChannelCheck` from the held recipe table, so a recipe edit changes the expectations with it.
 * Each nonzero held entry yields a check per band, except `unscoredRecipeEntries`; modulation is checked at clear
 * and strong only. Emotions without a held recipe (neutral) yield none.
 */
export function buildEmotionChecks(table: typeof NaturalEmotionTable = naturalEmotions): ChannelCheck[] {
  return (Object.keys(table) as PerformanceEmotion[]).flatMap((emotion) => {
    const held = table[emotion].held
    return held ? bands.flatMap(band => emotionChecks(emotion, held, band)) : []
  })
}
