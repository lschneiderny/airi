import type { RandomStream } from '@proj-airi/motion-driver-natural/random'
import type { Band, ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { ParameterRanges } from './liveliness'
import type { NaturalTrace, NaturalTraceEvent } from './trace'

import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import { NaturalGazeLayer } from '@proj-airi/motion-driver-natural/gaze'
import { gestureDuckRelease, gestureLifetimes } from '@proj-airi/motion-driver-natural/gestures'
import { impulseFaceLifetime, impulseLifetime } from '@proj-airi/motion-driver-natural/impulses'
import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

/**
 * Idle-noise-relative emotion scorer. Pure: no clocks, no `Math.random`, no Node APIs.
 *
 * Two stages, so a gate run can measure trials in parallel and aggregate once:
 * - `measureEmotionTrial` / `measurePlacebos` turn NaturalTrace v2 files into JSON-serializable records;
 * - `scoreEmotionGate` aggregates records into one `CheckResult` per `ChannelCheck`, with Holm correction
 *   across every significance test of the run.
 *
 * Every verdict proves direction, size relative to the recipe, release, and detectability above the rig's
 * idle noise. None of it says whether the motion looks natural; that stays a visual call.
 */

/** Channel classes; each has its own window and statistic in the gate's `windows`. */
export type ChannelClass = 'face' | 'eyelid' | 'posture' | 'modulation'

/** Scored channels and their classes. Composite channels combine rig parameters; see `channelSeries`. */
export const scoredChannels = {
  browMean: 'face',
  browAsym: 'face',
  browAngle: 'face',
  eyeSmile: 'face',
  mouthForm: 'face',
  mouthOpen: 'face',
  cheek: 'face',
  eyelid: 'eyelid',
  angleX: 'posture',
  angleY: 'posture',
  angleZ: 'posture',
  bodyAngleX: 'posture',
  bodyAngleY: 'posture',
  bodyAngleZ: 'posture',
  blinkRate: 'modulation',
  breathPeriod: 'modulation',
  headRms: 'modulation',
  cameraFixation: 'modulation',
} as const satisfies Record<string, ChannelClass>

export type ScoredChannel = keyof typeof scoredChannels
export type TrialVariant = 'full' | 'held-only' | 'long-hold'
export type Criterion = 'significance' | 'sign' | 'size' | 'visibility' | 'release'
/** `[start, end]` in seconds relative to the event the window belongs to. */
export type TimeWindow = readonly [start: number, end: number]

export interface SeedRange {
  start: number
  count: number
}

/** A committed emotion gate: every metric window, threshold, trial count, and seed rule the scorer applies. */
export interface EmotionGate {
  id: string
  /** Integer version; bump it whenever a threshold, window, or seed rule changes. */
  version: number
  /** The limitation every report must repeat. */
  limitation: string
  /** Scenario timings in seconds, matching the `motion-scenario` builders. */
  scenario: { warmup: number, hold: number, post: number, longHoldSeconds: number, longHoldPost: number, placeboSpacing: number }
  /** Windows relative to the pulse (`modulation`: the long-hold pulse). */
  windows: { baseline: TimeWindow, face: TimeWindow, eyelid: TimeWindow, posture: TimeWindow, modulation: TimeWindow }
  release: {
    /** Fit window relative to the pulse; its start is the end of the turnless hold. */
    window: TimeWindow
    late: TimeWindow
    /** Blink and breath release window, in seconds after the long hold ends. */
    modulationWindow: TimeWindow
    /** Accepted fitted tau as multiples of the nominal `held.releaseTau`. */
    tauRatio: TimeWindow
    /** The bootstrap tau CI must exclude this multiple of the nominal tau. */
    tauExcluded: number
    /** `|c| <= offsetShare * A`. */
    offsetShare: number
    /** Late-window CI must lie within `+-max(lateEffectShare * E, lateNoiseShare * sigma0)`. */
    lateEffectShare: number
    lateNoiseShare: number
    /** Blink-rate and breath-period ratios after release must lie within `1 +- ratioTolerance`. */
    ratioTolerance: number
  }
  visibility: { quantile: number, bands: Record<Band, { hitRate: number, d: number }> }
  size: { ratio: TimeWindow }
  seeds: { full: SeedRange, heldOnly: SeedRange, longHold: SeedRange }
  placeboPerNullRun: number
  family: { alpha: number, method: 'holm', permutations: number, bootstrap: number }
  levels: readonly ('t1' | 't2' | 't3')[]
}

/** One expectation generated from the recipe table (`buildEmotionChecks` in `gates.ts`). */
export interface ChannelCheck {
  /** `<emotion>:<band>:<channel>`, unique within a gate run. */
  key: string
  emotion: PerformanceEmotion
  band: Band
  channel: ScoredChannel
  cls: ChannelClass
  /** Expected direction: 1 when the recipe raises the channel. */
  sign: 1 | -1
  /** The recipe sign flips with the hold side (`hold` event `side`). */
  sided: boolean
  /**
   * Recipe amount per unit hold strength, in Natural output units: face offsets (`browMean` adds half the
   * one-sided raise), `eyeOpenMultiplier - 1` for the eyelid, the posture axis, or the modulation change
   * (`multiplier - 1`, or the additive camera-fixation delta).
   */
  recipe: number
  /** Eyelid only: the additive lid hint per unit strength (`eyeOpenHint`). */
  hint?: number
}

/** One channel of one trial. Values are in half-range units, log ratios for the eyelid and modulation channels. */
export interface ChannelMeasure {
  /** `stat(W) - stat(B)` on the emotion run; modulation: `log stat(W)`. */
  value: number
  /** The same statistic on the stripped run with the same seed; `null` when the trial is unpaired. */
  paired: number | null
  /** Held-only face and eyelid channels: emotion run minus stripped run on the release grid (30 Hz over `release.window`), unsigned. */
  trajectory?: number[]
}

/** JSON-serializable measurements of one trial; the gate CLI writes these as partials. */
export interface EmotionTrialRecord {
  trialId: string
  emotion: PerformanceEmotion
  band: Band
  variant: TrialVariant
  /** The hold side from the Natural `hold` event; `null` when the trace carries none. */
  side: -1 | 1 | null
  /** Why the lifetime rule rejects the trial, or `null`. */
  rejected: string | null
  /** Seconds after the pulse at which the hold releases. */
  releaseStart: number
  /** Seconds after the pulse at which impulse and glance residue on face and eyelid channels has ended. */
  faceResidue: number
  channels: Partial<Record<ScoredChannel, ChannelMeasure>>
  /** Channels the trace cannot measure, with the reason. */
  missing: Partial<Record<ScoredChannel, string>>
  /**
   * Capture session of an unpaired trial (rendered T3 runs). When trials and placebos carry it, unpaired checks are
   * scored session-stratified: each trial against its own session's placebo windows (`stratifiedUnpairedPValue`).
   */
  stratum?: string
  /** Long-hold only: blinks and breath intervals in `release.modulationWindow` after the hold ends. */
  modulationRelease?: {
    blinks: { run: number, paired: number | null }
    breath: { run: { total: number, intervals: number }, paired: { total: number, intervals: number } | null }
  }
}

/** One placebo window of an emotion-free run: unpaired `stat(W) - stat(B)` per channel. */
export interface PlaceboRecord {
  id: string
  channels: Partial<Record<ScoredChannel, number>>
  /** Capture session of the window; see `EmotionTrialRecord.stratum`. */
  stratum?: string
}

export interface ScorerInput {
  gate: EmotionGate
  checks: readonly ChannelCheck[]
  trials: readonly EmotionTrialRecord[]
  placebos: readonly PlaceboRecord[]
  /** Parameter ranges of the scored rig, for expected values and clamping. */
  ranges: ParameterRanges
  /**
   * Committed settings the expectations derive from: band nominals, onset and posture taus, and the nominal
   * release tau. Mutation runs change their own settings, never these. @default defaultExpressionPerformanceSettings
   */
  settings?: ExpressionPerformanceSettings
  /** Criteria to evaluate. A requested criterion without data is `n/a`, never a pass. @default every criterion of the class */
  criteria?: readonly Criterion[]
}

export interface CheckResult {
  key: string
  emotion: PerformanceEmotion
  band: Band
  channel: ScoredChannel
  /** Side metadata was missing, so the check tested `|delta|` against the folded placebo null. */
  unsigned: boolean
  /** Trials behind `E`: full variant, or long-hold for modulation. */
  n: number
  /** Trials the lifetime or residue rule rejected. */
  rejected: number
  /** Mean signed paired difference `mean(s * d)`. */
  E: number | null
  /** Bootstrap 95% CI of `E`. */
  ci: [number, number] | null
  /** `E / sigma0` of the placebo null; `null` for zero spread (the report's reasons explain it). */
  d: number | null
  hits: number | null
  hitRate: number | null
  p: number | null
  pHolm: number | null
  expected: number | null
  sizeRatio: number | null
  tau?: number | null
  tauCi?: [number, number] | null
  /** Release fit offset `c` and amplitude `A`, and the late-window mean with its CI; ratio for blink and breath. */
  residual?: { c: number | null, A: number | null, late: number | null, lateCi: [number, number] | null, ratio?: number | null }
  verdict: 'pass' | 'fail' | 'n/a'
  failed: Criterion[]
  /** Why a criterion is `n/a`, and other notes. */
  reasons: string[]
}

export interface EmotionGateScore {
  gate: { id: string, version: number }
  limitation: string
  /** Placebo noise per channel: SD, the visibility quantile, and the pool size (pooled over strata when stratified). */
  nullStats: Partial<Record<ScoredChannel, { sigma0: number, q: number, n: number }>>
  /** Stratified runs only: the same statistics per stratum, which are the nulls the checks are scored against. */
  strataNullStats?: Record<string, Partial<Record<ScoredChannel, { sigma0: number, q: number, n: number }>>>
  results: CheckResult[]
  pass: boolean
}

// --- Lifetimes ---------------------------------------------------------------------------------

/** Longest saccade (`gaze.ts` `saccadeTo`): an emotion glance has an outbound and a return saccade. */
const maxSaccadeSeconds = 0.09
/**
 * Longest face or eyelid response to one gaze shift: the 0.25 s lid narrowing (`face.ts`) or a pulled-forward
 * double blink, at most 0.35 + 0.22 + 0.35 s (`blink.ts`).
 */
const gazeResponseSeconds = 1

function performedBand(settings: ExpressionPerformanceSettings, band: Band): Band {
  // With band recruitment off every reaction runs as `clear` (impulses.ts `trigger`, pending-actions.ts gestures).
  return settings.bands ? band : 'clear'
}

/**
 * Seconds after an emotion pulse until everything the pulse started has retired: the head and body pulses and
 * face hints (`impulseLifetime`), the longest gesture clip plus the idle-motion duck release (`gestureLifetimes` + `gestureDuckRelease`; clips play only above `slight`
 * with held emotions on), and the glance (`faceHold` plus two saccades, above `slight`). The held emotion itself
 * is excluded: its release is what the scorer measures.
 */
export function naturalEmotionLifetime(settings: ExpressionPerformanceSettings, band: Band): number {
  const performed = performedBand(settings, band)
  const bandSettings = settings.naturalBands[performed]
  const gesture = performed !== 'slight' && settings.heldEmotions ? Math.max(...Object.values(gestureLifetimes)) + gestureDuckRelease : 0
  const glance = performed !== 'slight' ? bandSettings.faceHold + 2 * maxSaccadeSeconds : 0
  return Math.max(impulseLifetime(bandSettings), gesture, glance)
}

/**
 * Seconds after an emotion pulse until no impulse residue reaches the face and eyelid channels. Head pulses and
 * every gesture clip but the laugh write head and body only; the laugh also adds a smile and a mouth opening
 * for its whole lifetime (`gestureLifetimes.laugh`, clear and strong with held emotions on). Glances reach the
 * face only through gaze-evoked lid narrowing and blinks, which end `gazeResponseSeconds` after the last shift
 * they cause. The held-only variant zeroes the face hints, so its residue is the glance and laugh parts.
 */
export function naturalFaceResidue(settings: ExpressionPerformanceSettings, band: Band): number {
  const performed = performedBand(settings, band)
  const bandSettings = settings.naturalBands[performed]
  const glance = performed !== 'slight' ? bandSettings.faceHold + 2 * maxSaccadeSeconds + gazeResponseSeconds : 0
  const laugh = performed !== 'slight' && settings.heldEmotions ? gestureLifetimes.laugh : 0
  return Math.max(impulseFaceLifetime(bandSettings), glance, laugh)
}

// --- Statistics --------------------------------------------------------------------------------

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

function sampleSd(values: readonly number[]) {
  if (values.length < 2)
    return 0
  const center = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1))
}

/** Linear-interpolation quantile (Hyndman-Fan type 7), `p` in [0, 1]. */
export function quantile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

/** FNV-1a over the UTF-16 code units; seeds every resampling stream from the gate id and the check key. */
export function hashSeed(text: string): number {
  let hash = 0x811C9DC5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function uint32(random: RandomStream) {
  // `createRandomStream` returns a uint32 divided by 2^32, so this recovers its 32 bits exactly.
  return Math.floor(random() * 2 ** 32) >>> 0
}

/**
 * One-sided sign-flip permutation p-value for `mean(values) > 0`. Enumerates all `2^n` sign patterns when that is
 * at most `permutations`, otherwise draws `permutations` random patterns and returns `(hits + 1) / (permutations + 1)`.
 */
export function signFlipPValue(values: readonly number[], permutations: number, random: RandomStream): number {
  const n = values.length
  if (n === 0)
    return 1
  const observed = values.reduce((sum, value) => sum + value, 0)
  // Relative tolerance keeps exact ties (all-zero differences) counting as at least as extreme.
  const tolerance = 1e-12 * values.reduce((sum, value) => sum + Math.abs(value), 0)
  if (n <= 30 && 2 ** n <= permutations) {
    let hits = 0
    for (let pattern = 0; pattern < 2 ** n; pattern++) {
      let total = 0
      for (let index = 0; index < n; index++)
        total += (pattern >>> index) & 1 ? -values[index] : values[index]
      if (total >= observed - tolerance)
        hits++
    }
    return hits / 2 ** n
  }
  let hits = 0
  for (let draw = 0; draw < permutations; draw++) {
    let total = 0
    for (let offset = 0; offset < n; offset += 32) {
      let bits = uint32(random)
      const end = Math.min(n, offset + 32)
      for (let index = offset; index < end; index++) {
        total += bits & 1 ? -values[index] : values[index]
        bits >>>= 1
      }
    }
    if (total >= observed - tolerance)
      hits++
  }
  return (hits + 1) / (permutations + 1)
}

/** One-sided two-sample permutation p-value for `mean(sample) > mean(reference)`, by random relabeling. */
export function twoSamplePValue(sample: readonly number[], reference: readonly number[], permutations: number, random: RandomStream): number {
  if (!sample.length || !reference.length)
    return 1
  const pooled = [...sample, ...reference]
  const total = pooled.reduce((sum, value) => sum + value, 0)
  const statistic = (sampleSum: number) => sampleSum / sample.length - (total - sampleSum) / reference.length
  const observed = statistic(sample.reduce((sum, value) => sum + value, 0))
  const tolerance = 1e-12 * pooled.reduce((sum, value) => sum + Math.abs(value), 0)
  let hits = 0
  for (let draw = 0; draw < permutations; draw++) {
    // Partial Fisher-Yates: the first `sample.length` slots become the relabeled sample.
    let sampleSum = 0
    for (let index = 0; index < sample.length; index++) {
      const pick = index + Math.floor(random() * (pooled.length - index))
      const value = pooled[pick]
      pooled[pick] = pooled[index]
      pooled[index] = value
      sampleSum += value
    }
    if (statistic(sampleSum) >= observed - tolerance)
      hits++
  }
  return (hits + 1) / (permutations + 1)
}

/**
 * One-sided two-sample permutation p-value for unpaired trials: `sample[i]` (oriented by `signs[i]`) against the
 * `reference` pool, statistic `mean(s * x) - mean(s) * mean(reference)`. Pooled values are relabeled; with equal
 * signs and at most `permutations` subsets the test enumerates them exactly, otherwise it draws `permutations` random
 * relabelings and returns `(hits + 1) / (permutations + 1)`.
 */
export function unpairedPValue(sample: readonly number[], signs: readonly number[], reference: readonly number[], permutations: number, random: RandomStream): number {
  const n = sample.length
  const m = reference.length
  if (!n || !m)
    return 1
  const pooled = [...sample, ...reference]
  const total = pooled.reduce((sum, value) => sum + value, 0)
  const meanSign = signs.reduce((sum, sign) => sum + sign, 0) / n
  const statistic = (weighted: number, plain: number) => weighted / n - meanSign * (total - plain) / m
  const observed = statistic(sample.reduce((sum, value, index) => sum + signs[index] * value, 0), sample.reduce((sum, value) => sum + value, 0))
  const tolerance = 1e-12 * pooled.reduce((sum, value) => sum + Math.abs(value), 0)

  // C(n + m, k) with k = min(n, m): the running product only grows, so an early stop never hides a small count.
  let subsets = 1
  for (let index = 0; index < Math.min(n, m) && subsets <= permutations; index++)
    subsets = subsets * (n + m - index) / (index + 1)
  if (signs.every(sign => sign === signs[0]) && subsets <= permutations) {
    let hits = 0
    let count = 0
    const visit = (start: number, left: number, plain: number) => {
      if (left === 0) {
        count++
        if (statistic(signs[0] * plain, plain) >= observed - tolerance)
          hits++
        return
      }
      for (let index = start; index <= pooled.length - left; index++)
        visit(index + 1, left - 1, plain + pooled[index])
    }
    visit(0, n, 0)
    return hits / count
  }
  let hits = 0
  for (let draw = 0; draw < permutations; draw++) {
    // Partial Fisher-Yates: the first `n` slots become the relabeled trials, in trial order with their signs.
    let weighted = 0
    let plain = 0
    for (let index = 0; index < n; index++) {
      const pick = index + Math.floor(random() * (pooled.length - index))
      const value = pooled[pick]
      pooled[pick] = pooled[index]
      pooled[index] = value
      weighted += signs[index] * value
      plain += value
    }
    if (statistic(weighted, plain) >= observed - tolerance)
      hits++
  }
  return (hits + 1) / (permutations + 1)
}

/** One stratum (capture session) of a stratified unpaired test: its trials with their signs, and its placebo values. */
export interface UnpairedStratum {
  sample: readonly number[]
  signs: readonly number[]
  reference: readonly number[]
}

/**
 * Stratified unpaired effect: the mean over all trials of `s_i * (x_i - mean(reference of the trial's stratum))`. With
 * one stratum it equals the unpaired statistic `mean(s * x) - mean(s) * mean(reference)`.
 */
export function stratifiedUnpairedEffect(strata: readonly UnpairedStratum[]): number {
  let total = 0
  let trials = 0
  for (const { sample, signs, reference } of strata) {
    const nullMean = reference.reduce((sum, value) => sum + value, 0) / reference.length
    sample.forEach((value, index) => {
      total += signs[index] * (value - nullMean)
    })
    trials += sample.length
  }
  return total / trials
}

/**
 * One-sided stratified permutation p-value for `stratifiedUnpairedEffect > 0`: trial and placebo labels are permuted
 * only within each stratum, so a session whose placebo level differs from another's never lends its null to it.
 * One stratum is exactly `unpairedPValue`. With equal signs and at most `permutations` joint relabelings the test
 * enumerates them; otherwise it draws `permutations` relabelings and returns `(hits + 1) / (permutations + 1)`.
 * Every stratum needs at least one trial and one placebo value; callers drop the others.
 */
export function stratifiedUnpairedPValue(strata: readonly UnpairedStratum[], permutations: number, random: RandomStream): number {
  if (!strata.length || strata.some(stratum => !stratum.sample.length || !stratum.reference.length))
    return 1
  if (strata.length === 1)
    return unpairedPValue(strata[0].sample, strata[0].signs, strata[0].reference, permutations, random)
  const prepared = strata.map(({ sample, signs, reference }) => {
    const pooled = [...sample, ...reference]
    return { pooled, n: sample.length, m: reference.length, signs, signSum: signs.reduce((sum, sign) => sum + sign, 0), total: pooled.reduce((sum, value) => sum + value, 0) }
  })
  const trials = prepared.reduce((sum, stratum) => sum + stratum.n, 0)
  // Per stratum: sum over trial slots of s * x, minus the slots' sign sum times the mean of the remaining (placebo) values.
  const contribution = (stratum: typeof prepared[number], weighted: number, plain: number) => weighted - stratum.signSum * (stratum.total - plain) / stratum.m
  const observed = prepared.reduce((sum, stratum) => {
    const weighted = stratum.pooled.slice(0, stratum.n).reduce((acc, value, index) => acc + stratum.signs[index] * value, 0)
    const plain = stratum.pooled.slice(0, stratum.n).reduce((acc, value) => acc + value, 0)
    return sum + contribution(stratum, weighted, plain)
  }, 0) / trials
  const tolerance = 1e-12 * prepared.reduce((sum, stratum) => sum + stratum.pooled.reduce((acc, value) => acc + Math.abs(value), 0), 0)

  // Joint relabelings: the product over strata of C(n + m, n); the running product stops once it exceeds the budget.
  let joint = 1
  for (const { n, m } of prepared) {
    for (let index = 0; index < Math.min(n, m) && joint <= permutations; index++)
      joint = joint * (n + m - index) / (index + 1)
  }
  const equalSigns = prepared.every(stratum => stratum.signs.every(sign => sign === prepared[0].signs[0]))
  if (equalSigns && joint <= permutations) {
    const sign = prepared[0].signs[0]
    let hits = 0
    let count = 0
    const visitStratum = (stratumIndex: number, accumulated: number) => {
      if (stratumIndex === prepared.length) {
        count++
        if (accumulated / trials >= observed - tolerance)
          hits++
        return
      }
      const stratum = prepared[stratumIndex]
      const visit = (start: number, left: number, plain: number) => {
        if (left === 0) {
          visitStratum(stratumIndex + 1, accumulated + contribution(stratum, sign * plain, plain))
          return
        }
        for (let index = start; index <= stratum.pooled.length - left; index++)
          visit(index + 1, left - 1, plain + stratum.pooled[index])
      }
      visit(0, stratum.n, 0)
    }
    visitStratum(0, 0)
    return hits / count
  }
  let hits = 0
  for (let draw = 0; draw < permutations; draw++) {
    let accumulated = 0
    for (const stratum of prepared) {
      // Partial Fisher-Yates within the stratum: its first `n` slots become its relabeled trials, with their signs.
      let weighted = 0
      let plain = 0
      for (let index = 0; index < stratum.n; index++) {
        const pick = index + Math.floor(random() * (stratum.pooled.length - index))
        const value = stratum.pooled[pick]
        stratum.pooled[pick] = stratum.pooled[index]
        stratum.pooled[index] = value
        weighted += stratum.signs[index] * value
        plain += value
      }
      accumulated += contribution(stratum, weighted, plain)
    }
    if (accumulated / trials >= observed - tolerance)
      hits++
  }
  return (hits + 1) / (permutations + 1)
}

/** Holm step-down adjusted p-values, in input order. Ties keep input order, so callers sort keys first. */
export function holmAdjust(pValues: readonly number[]): number[] {
  const order = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p || a.index - b.index)
  const adjusted = Array.from<number>({ length: pValues.length })
  let running = 0
  order.forEach(({ p, index }, rank) => {
    running = Math.max(running, Math.min(1, (pValues.length - rank) * p))
    adjusted[index] = running
  })
  return adjusted
}

/** Percentile bootstrap: resamples indices with replacement and returns the 2.5% and 97.5% quantiles of `statistic`. */
function bootstrapCi(n: number, resamples: number, random: RandomStream, statistic: (indices: number[]) => number): [number, number] {
  const values: number[] = []
  const indices = Array.from<number>({ length: n })
  for (let draw = 0; draw < resamples; draw++) {
    for (let index = 0; index < n; index++)
      indices[index] = Math.floor(random() * n)
    values.push(statistic(indices))
  }
  return [quantile(values, 0.025), quantile(values, 0.975)]
}

export interface ExponentialFit {
  A: number
  tau: number
  c: number
}

/**
 * Least-squares fit of `A exp(-(t - t0) / tau) + c`. For each tau, A and c solve a linear least-squares problem;
 * tau is searched on a log grid over [0.02, 30] s and refined by golden-section search in the best bracket.
 */
export function fitExponential(times: readonly number[], values: readonly number[], t0: number): ExponentialFit {
  const solve = (tau: number) => {
    let se = 0
    let see = 0
    let sy = 0
    let sey = 0
    for (let index = 0; index < times.length; index++) {
      const e = Math.exp(-(times[index] - t0) / tau)
      se += e
      see += e * e
      sy += values[index]
      sey += e * values[index]
    }
    const n = times.length
    const determinant = see * n - se * se
    const A = determinant === 0 ? 0 : (sey * n - se * sy) / determinant
    const c = (sy - A * se) / n
    let sse = 0
    for (let index = 0; index < times.length; index++)
      sse += (values[index] - A * Math.exp(-(times[index] - t0) / tau) - c) ** 2
    return { A, c, sse }
  }
  const grid = Array.from({ length: 81 }, (_, index) => Math.log(0.02) + (Math.log(30) - Math.log(0.02)) * index / 80)
  let best = 0
  let bestSse = Number.POSITIVE_INFINITY
  grid.forEach((logTau, index) => {
    const { sse } = solve(Math.exp(logTau))
    if (sse < bestSse) {
      bestSse = sse
      best = index
    }
  })
  let low = grid[Math.max(0, best - 1)]
  let high = grid[Math.min(grid.length - 1, best + 1)]
  const ratio = (Math.sqrt(5) - 1) / 2
  let a = high - ratio * (high - low)
  let b = low + ratio * (high - low)
  let fa = solve(Math.exp(a)).sse
  let fb = solve(Math.exp(b)).sse
  for (let iteration = 0; iteration < 80; iteration++) {
    if (fa <= fb) {
      high = b
      b = a
      fb = fa
      a = high - ratio * (high - low)
      fa = solve(Math.exp(a)).sse
    }
    else {
      low = a
      a = b
      fa = fb
      b = low + ratio * (high - low)
      fb = solve(Math.exp(b)).sse
    }
  }
  const tau = Math.exp((low + high) / 2)
  const { A, c } = solve(tau)
  return { A, tau, c }
}

// --- Trace channels ----------------------------------------------------------------------------

/** Blink: lid below this share of the running 1 s 80th percentile. */
const blinkDepth = 0.5
/** A closure longer than this is not a blink. */
const blinkMaxSeconds = 0.4
const blinkRefractorySeconds = 0.15
/** Breath upward crossings of `center` (breath.ts) with hysteresis. */
const breathCenter = 0.45
const breathHysteresis = 0.02
/**
 * Camera fixation: reconstructed gaze within this radius of the camera point, half the distance to the
 * nearest other autonomous target (peripheral at x +-0.12, `gaze.ts` `targets`).
 */
const cameraRadius = 0.06
/** Eye counter-rotation per unit head pose, read back from `NaturalGazeLayer.eye` (eye = gaze - K head). */
const gazeCompensation = (() => {
  const eye = NaturalGazeLayer.eye({ x: 0, y: 0 }, { x: 1, y: 1 })
  return { x: -eye.x, y: -eye.y }
})()

const parameterIds = {
  angleX: 'ParamAngleX',
  angleY: 'ParamAngleY',
  angleZ: 'ParamAngleZ',
  bodyAngleX: 'ParamBodyAngleX',
  bodyAngleY: 'ParamBodyAngleY',
  bodyAngleZ: 'ParamBodyAngleZ',
  mouthForm: 'ParamMouthForm',
  mouthOpen: 'ParamMouthOpenY',
  cheek: 'ParamCheek',
} as const
const pairs = {
  browMean: ['ParamBrowLY', 'ParamBrowRY'],
  browAngle: ['ParamBrowLAngle', 'ParamBrowRAngle'],
  eyeSmile: ['ParamEyeLSmile', 'ParamEyeRSmile'],
} as const

type SeriesResult = { values: number[] } | { reason: string }

function halfRange(ranges: ParameterRanges, id: string) {
  const range = ranges[id]
  return range && range.max > range.min ? (range.max - range.min) / 2 : null
}

function normalized(trace: NaturalTrace, id: string): SeriesResult {
  const values = trace.channels[id]
  const half = halfRange(trace.ranges, id)
  if (!values)
    return { reason: `trace has no ${id} column` }
  if (half === null)
    return { reason: `trace has no usable range for ${id}` }
  return { values: values.map(value => value / half) }
}

/** Per-sample values of a scored face, eyelid, or posture channel: half-range units, raw lid openness for the eyelid. */
function channelSeries(trace: NaturalTrace, channel: ScoredChannel): SeriesResult {
  if (channel in parameterIds)
    return normalized(trace, parameterIds[channel as keyof typeof parameterIds])
  if (channel === 'browMean' || channel === 'browAngle' || channel === 'eyeSmile' || channel === 'browAsym') {
    const [left, right] = (channel === 'browAsym' ? pairs.browMean : pairs[channel]).map(id => normalized(trace, id))
    if ('reason' in left)
      return left
    if ('reason' in right)
      return right
    // browAsym = (LY - RY) / 2; the side sign is applied with the check sign, so side 1 (left raise) reads positive.
    return { values: left.values.map((value, index) => channel === 'browAsym' ? (value - right.values[index]) / 2 : (value + right.values[index]) / 2) }
  }
  if (channel === 'eyelid') {
    const columns = ['ParamEyeLOpen', 'ParamEyeROpen'].map(id => trace.channels[id]).filter(values => values !== undefined)
    if (!columns.length)
      return { reason: 'trace has no ParamEyeLOpen or ParamEyeROpen column' }
    return { values: columns[0].map((_, index) => columns.reduce((sum, values) => sum + values[index], 0) / columns.length) }
  }
  return { reason: `${channel} is a modulation channel` }
}

/** Index range `[from, to)` of samples with `start <= t <= end`. */
function windowIndices(times: readonly number[], start: number, end: number): [number, number] {
  const epsilon = 1e-9
  let from = 0
  let to = times.length
  let low = 0
  let high = times.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (times[middle] < start - epsilon)
      low = middle + 1
    else
      high = middle
  }
  from = low
  low = from
  high = times.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (times[middle] <= end + epsilon)
      low = middle + 1
    else
      high = middle
  }
  to = low
  return [from, to]
}

function windowValues(times: readonly number[], values: readonly number[], start: number, end: number) {
  const [from, to] = windowIndices(times, start, end)
  return values.slice(from, to)
}

/**
 * The reason a measurement is missing when any listed sample is NaN or infinite, else `null`. A non-finite sample
 * would otherwise turn the effect into NaN, which no comparison rejects (a permutation test then reports p = 0).
 */
function nonFiniteReason(channel: ScoredChannel, ...windows: readonly (readonly number[])[]): string | null {
  return windows.some(values => values.some(value => !Number.isFinite(value)))
    ? `non-finite sample in the ${channel} trial window`
    : null
}

/**
 * The reason a derived per-trial measurement is missing when its value, its paired value, or their difference is
 * not finite, else `null`. Records read from JSON carry `null` where a non-finite number was written.
 */
function derivedNonFiniteReason(channel: ScoredChannel, value: number, paired: number | null): string | null {
  if (!Number.isFinite(value))
    return `non-finite ${channel} measurement (value ${value})`
  if (paired !== null && (!Number.isFinite(paired) || !Number.isFinite(value - paired)))
    return `non-finite ${channel} paired difference (value ${value}, paired ${paired})`
  return null
}

/** Linear interpolation at `time`; `NaN` outside the sampled span. */
function interpolate(times: readonly number[], values: readonly number[], time: number) {
  if (!times.length || time < times[0] - 1e-9 || time > times[times.length - 1] + 1e-9)
    return Number.NaN
  const [index] = windowIndices(times, time, time)
  if (index >= times.length)
    return values[times.length - 1]
  if (index === 0 || Math.abs(times[index] - time) < 1e-9)
    return values[index]
  const weight = (time - times[index - 1]) / (times[index] - times[index - 1])
  return values[index - 1] + (values[index] - values[index - 1]) * weight
}

/** Running 80th percentile over a centered 1 s window, as the blink detector and eyelid trajectories use it. */
function runningLidReference(times: readonly number[], lid: readonly number[], time: number) {
  const values = windowValues(times, lid, time - 0.5, time + 0.5)
  return values.length ? quantile(values, 0.8) : Number.NaN
}

/** Blink start times in `[start, end)`. */
function detectBlinks(times: readonly number[], lid: readonly number[], start: number, end: number): number[] {
  const [from, to] = windowIndices(times, start - 1, end + 1)
  const blinks: number[] = []
  let lastEnd = Number.NEGATIVE_INFINITY
  let index = from
  while (index < to) {
    const threshold = blinkDepth * runningLidReference(times, lid, times[index])
    if (!(lid[index] < threshold)) {
      index++
      continue
    }
    let last = index
    while (last + 1 < to && lid[last + 1] < threshold)
      last++
    const closedAt = times[index]
    const reopenedAt = times[Math.min(last + 1, times.length - 1)]
    if (reopenedAt - closedAt <= blinkMaxSeconds && closedAt - lastEnd >= blinkRefractorySeconds && closedAt >= start && closedAt < end)
      blinks.push(closedAt)
    lastEnd = reopenedAt
    index = last + 1
  }
  return blinks
}

/** Upward crossings of the breath center in `[start, end)`, interpolated between samples. */
function breathCrossings(times: readonly number[], breath: readonly number[], start: number, end: number): number[] {
  const crossings: number[] = []
  let armed = false
  for (let index = 0; index < times.length; index++) {
    if (breath[index] < breathCenter - breathHysteresis) {
      armed = true
      continue
    }
    if (!armed || breath[index] <= breathCenter + breathHysteresis)
      continue
    armed = false
    let rise = index
    while (rise > 0 && breath[rise - 1] > breathCenter)
      rise--
    const crossedAt = rise === 0
      ? times[0]
      : times[rise - 1] + (breathCenter - breath[rise - 1]) / (breath[rise] - breath[rise - 1]) * (times[rise] - times[rise - 1])
    if (crossedAt >= start && crossedAt < end)
      crossings.push(crossedAt)
  }
  return crossings
}

/** RMS of the least-squares residual of each head axis, combined as the root mean square over axes. */
function detrendedRms(times: readonly number[], axes: readonly (readonly number[])[]) {
  const t = mean(times)
  const stt = times.reduce((sum, time) => sum + (time - t) ** 2, 0)
  let total = 0
  for (const values of axes) {
    const v = mean(values)
    const slope = stt === 0 ? 0 : times.reduce((sum, time, index) => sum + (time - t) * (values[index] - v), 0) / stt
    total += mean(values.map((value, index) => (value - v - slope * (times[index] - t)) ** 2))
  }
  return Math.sqrt(total / axes.length)
}

/** Log modulation statistic of one trace over `[start, end]` seconds of trace time. */
function modulationStatistic(trace: NaturalTrace, channel: ScoredChannel, start: number, end: number): number | string {
  const times = trace.t
  if (start < times[0] - 1e-9 || end > times[times.length - 1] + 1e-9)
    return `window [${start}, ${end}] s is outside the trace`
  switch (channel) {
    case 'blinkRate': {
      const lid = channelSeries(trace, 'eyelid')
      if ('reason' in lid)
        return lid.reason
      const invalid = nonFiniteReason(channel, windowValues(times, lid.values, start - 1, end + 1))
      if (invalid)
        return invalid
      // Half a blink of continuity keeps the log finite when a window has none.
      return Math.log((detectBlinks(times, lid.values, start, end).length + 0.5) / (end - start))
    }
    case 'breathPeriod': {
      const breath = trace.channels.ParamBreath
      if (!breath)
        return 'trace has no ParamBreath column'
      const invalid = nonFiniteReason(channel, windowValues(times, breath, start, end))
      if (invalid)
        return invalid
      const crossings = breathCrossings(times, breath, start, end)
      if (crossings.length < 2)
        return 'fewer than two breath crossings in the window'
      return Math.log((crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1))
    }
    case 'headRms': {
      const axes: number[][] = []
      for (const id of ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ']) {
        const series = normalized(trace, id)
        if ('reason' in series)
          return series.reason
        axes.push(windowValues(times, series.values, start, end))
      }
      const invalidAxes = nonFiniteReason(channel, ...axes)
      if (invalidAxes)
        return invalidAxes
      const rms = detrendedRms(windowValues(times, times, start, end), axes)
      // A stationary window has zero RMS, and its log is -Infinity; a paired difference of two such logs is NaN.
      if (!(rms > 0))
        return 'non-finite headRms log ratio (zero RMS)'
      return Math.log(rms)
    }
    case 'cameraFixation': {
      const columns: number[][] = []
      for (const id of ['ParamEyeBallX', 'ParamEyeBallY', 'ParamAngleX', 'ParamAngleY']) {
        const series = normalized(trace, id)
        if ('reason' in series)
          return series.reason
        columns.push(windowValues(times, series.values, start, end))
      }
      const invalidColumns = nonFiniteReason(channel, ...columns)
      if (invalidColumns)
        return invalidColumns
      const [eyeX, eyeY, headX, headY] = columns
      const fixated = eyeX.filter((_, index) => Math.hypot(eyeX[index] + gazeCompensation.x * headX[index], eyeY[index] + gazeCompensation.y * headY[index]) < cameraRadius).length
      // Laplace-style continuity keeps the log finite for all-off or all-on windows.
      return Math.log((fixated + 0.5) / (eyeX.length + 1))
    }
    default:
      return `${channel} is not a modulation channel`
  }
}

/** Unpaired `stat(W) - stat(B)` of a face, eyelid, or posture channel around `pulse` (trace seconds). */
function eventDelta(trace: NaturalTrace, channel: ScoredChannel, pulse: number, gate: EmotionGate): number | string {
  const series = channelSeries(trace, channel)
  if ('reason' in series)
    return series.reason
  const cls = scoredChannels[channel]
  const window = cls === 'face' ? gate.windows.face : cls === 'eyelid' ? gate.windows.eyelid : gate.windows.posture
  const baseline = windowValues(trace.t, series.values, pulse + gate.windows.baseline[0], pulse + gate.windows.baseline[1])
  const scored = windowValues(trace.t, series.values, pulse + window[0], pulse + window[1])
  if (baseline.length < 2 || scored.length < 2)
    return `window around ${pulse} s is outside the trace`
  const invalid = nonFiniteReason(channel, baseline, scored)
  if (invalid)
    return invalid
  if (cls === 'eyelid') {
    const base = quantile(baseline, 0.8)
    const level = quantile(scored, 0.8)
    if (!(base > 0) || !(level > 0))
      return 'eyelid 80th percentile is not positive'
    return Math.log(level / base)
  }
  return mean(scored) - mean(baseline)
}

/**
 * Release trajectory on the 30 Hz grid over `release.window`: baseline-relative values, ratios minus 1 for the eyelid.
 * Held-only records store the emotion run minus the stripped run; single rendered traces (T3) use it unpaired.
 */
export function releaseTrajectory(trace: NaturalTrace, channel: ScoredChannel, pulse: number, gate: EmotionGate): number[] | string {
  const series = channelSeries(trace, channel)
  if ('reason' in series)
    return series.reason
  const grid = releaseGrid(gate)
  const baseline = windowValues(trace.t, series.values, pulse + gate.windows.baseline[0], pulse + gate.windows.baseline[1])
  if (baseline.length < 2)
    return 'baseline is outside the trace'
  if (scoredChannels[channel] === 'eyelid') {
    // The running 80th percentile ignores blinks; on a monotone release it is a pure time shift, so tau is unchanged.
    const base = quantile(baseline, 0.8)
    const values = grid.map(time => runningLidReference(trace.t, series.values, pulse + time) / base - 1)
    return values.every(Number.isFinite) ? values : 'release window is outside the trace'
  }
  const base = mean(baseline)
  const values = grid.map(time => interpolate(trace.t, series.values, pulse + time) - base)
  return values.every(Number.isFinite) ? values : 'release window is outside the trace'
}

/** Times (seconds after the pulse) of `releaseTrajectory` values. */
export function releaseGrid(gate: EmotionGate) {
  const [start, end] = gate.release.window
  return Array.from({ length: Math.round((end - start) * 30) + 1 }, (_, index) => start + index / 30)
}

// --- Trial extraction --------------------------------------------------------------------------

function sortedEvents(trace: NaturalTrace): NaturalTraceEvent[] {
  // Input event order must not change results: sort by time, then by a stable serialization.
  return trace.events
    .map(event => ({ event, order: JSON.stringify(event) }))
    .sort((a, b) => a.event.t - b.event.t || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map(({ event }) => event)
}

function assertTrace(trace: NaturalTrace, role: string) {
  if (trace?.version !== 2 || !Array.isArray(trace.events))
    throw new Error(`The ${role} trace is not a NaturalTrace version 2 with events.`)
  if (!trace.events.length)
    throw new Error(`The ${role} trace has no events; the scorer aligns trials on scenario events.`)
  if (!Array.isArray(trace.t) || trace.t.length < 2)
    throw new Error(`The ${role} trace has fewer than two samples.`)
}

const faceAndPosture = (Object.keys(scoredChannels) as ScoredChannel[]).filter(channel => scoredChannels[channel] !== 'modulation')
const modulationChannels = (Object.keys(scoredChannels) as ScoredChannel[]).filter(channel => scoredChannels[channel] === 'modulation')

export interface MeasureTrialOptions {
  /** `trialId` of the scenario `emotion` event (and of the stripped run's `noop`). */
  trialId: string
  variant: TrialVariant
  gate: EmotionGate
  /** Settings the run used (scenario `settings.performance` parsed); they set lifetimes and residue. @default defaultExpressionPerformanceSettings */
  settings?: ExpressionPerformanceSettings
}

/**
 * Measures one trial from its emotion run and, for paired scoring, the stripped run with the same seed.
 * Throws with a reason when the traces cannot be aligned: no version 2 events, no scenario event for the trial,
 * or an emotion the recipe table does not know.
 */
export function measureEmotionTrial(run: NaturalTrace, paired: NaturalTrace | null, options: MeasureTrialOptions): EmotionTrialRecord {
  const { trialId, variant, gate } = options
  const settings = options.settings ?? defaultExpressionPerformanceSettings
  assertTrace(run, 'emotion')
  const events = sortedEvents(run)
  const pulseEvent = events.find(entry => entry.source === 'scenario' && entry.event.kind === 'emotion' && entry.event.trialId === trialId)
  if (!pulseEvent || pulseEvent.source !== 'scenario' || pulseEvent.event.kind !== 'emotion')
    throw new Error(`The emotion trace has no scenario emotion event with trialId ${trialId}.`)
  const { emotion, band } = pulseEvent.event
  if (!Object.hasOwn(naturalEmotions, emotion) || emotion === 'neutral' || !naturalEmotions[emotion].held)
    throw new Error(`Trial ${trialId} names emotion "${emotion}", which has no held recipe to score.`)
  const pulse = pulseEvent.t

  let pairedPulse: number | null = null
  if (paired) {
    assertTrace(paired, 'stripped')
    const noop = sortedEvents(paired).find(entry => entry.source === 'scenario' && entry.event.kind === 'noop' && entry.event.trialId === trialId)
    if (!noop)
      throw new Error(`The stripped trace has no scenario noop event with trialId ${trialId}.`)
    pairedPulse = noop.t
  }

  // The side of the hold this pulse started: the first `hold` event for the emotion at or after the pulse.
  const hold = events.find(entry => entry.source === 'natural' && entry.event.kind === 'hold' && entry.event.emotion === emotion && entry.t >= pulse - 1e-6 && entry.t <= pulse + 1)
  const side = hold?.source === 'natural' && hold.event.kind === 'hold' ? hold.event.side : null

  const releaseStart = variant === 'long-hold' ? gate.scenario.longHoldSeconds : gate.scenario.hold
  const span: TimeWindow = variant === 'long-hold'
    ? [gate.windows.baseline[0], releaseStart + gate.release.modulationWindow[1]]
    : [gate.windows.baseline[0], variant === 'held-only' ? gate.release.window[1] : Math.max(gate.windows.face[1], gate.windows.eyelid[1], gate.windows.posture[1])]
  let rejected: string | null = null
  for (const entry of events) {
    if (entry === pulseEvent || entry.source !== 'scenario' || (entry.event.kind !== 'emotion' && entry.event.kind !== 'act'))
      continue
    // Raw ACT markers carry no band; assume the longest (strong) lifetime.
    const lifetime = naturalEmotionLifetime(settings, entry.event.kind === 'emotion' ? entry.event.band : 'strong')
    if (entry.t <= pulse + span[1] && entry.t + lifetime >= pulse + span[0]) {
      rejected = `another ${entry.event.kind} event at ${entry.t} s (lifetime ${lifetime} s) overlaps the trial window [${span[0]}, ${span[1]}] s`
      break
    }
  }

  const channels: EmotionTrialRecord['channels'] = {}
  const missing: EmotionTrialRecord['missing'] = {}
  const record = (channel: ScoredChannel, value: number | string, pairedValue: number | string | null, trajectory?: number[] | string, pairedTrajectory?: number[] | string) => {
    if (typeof value === 'string') {
      missing[channel] = value
      return
    }
    if (typeof pairedValue === 'string') {
      missing[channel] = `stripped run: ${pairedValue}`
      return
    }
    // Derived values follow the raw-sample rule: a non-finite value or paired difference would enter the
    // permutation test as NaN, which no comparison rejects (p = 0), so the trial is missing for this channel.
    const invalid = derivedNonFiniteReason(channel, value, pairedValue)
    if (invalid) {
      missing[channel] = invalid
      return
    }
    const measure: ChannelMeasure = { value, paired: pairedValue }
    if (Array.isArray(trajectory) && Array.isArray(pairedTrajectory))
      measure.trajectory = trajectory.map((entry, index) => entry - pairedTrajectory[index])
    else if (typeof trajectory === 'string' || typeof pairedTrajectory === 'string')
      missing[channel] = `release trajectory: ${typeof trajectory === 'string' ? trajectory : pairedTrajectory}`
    channels[channel] = measure
  }

  if (variant === 'long-hold') {
    const [start, end] = gate.windows.modulation
    for (const channel of modulationChannels) {
      record(
        channel,
        modulationStatistic(run, channel, pulse + start, pulse + end),
        paired && pairedPulse !== null ? modulationStatistic(paired, channel, pairedPulse + start, pairedPulse + end) : null,
      )
    }
    const [from, to] = gate.release.modulationWindow
    const blinks = (trace: NaturalTrace, at: number) => {
      const lid = channelSeries(trace, 'eyelid')
      return 'reason' in lid ? null : detectBlinks(trace.t, lid.values, at + releaseStart + from, at + releaseStart + to).length
    }
    const breath = (trace: NaturalTrace, at: number) => {
      const values = trace.channels.ParamBreath
      if (!values)
        return null
      const crossings = breathCrossings(trace.t, values, at + releaseStart + from, at + releaseStart + to)
      return crossings.length < 2 ? null : { total: crossings[crossings.length - 1] - crossings[0], intervals: crossings.length - 1 }
    }
    const runBlinks = blinks(run, pulse)
    const runBreath = breath(run, pulse)
    // The 30 Hz recorder may keep its last sample just before the scenario endpoint.
    if (runBlinks !== null && runBreath !== null && run.t[run.t.length - 1] >= pulse + releaseStart + to - 1 / 30) {
      return {
        trialId,
        emotion,
        band,
        variant,
        side,
        rejected,
        releaseStart,
        faceResidue: naturalFaceResidue(settings, band),
        channels,
        missing,
        modulationRelease: {
          blinks: { run: runBlinks, paired: paired && pairedPulse !== null ? blinks(paired, pairedPulse) : null },
          breath: { run: runBreath, paired: paired && pairedPulse !== null ? breath(paired, pairedPulse) : null },
        },
      }
    }
    return { trialId, emotion, band, variant, side, rejected, releaseStart, faceResidue: naturalFaceResidue(settings, band), channels, missing }
  }

  for (const channel of faceAndPosture) {
    const withTrajectory = variant === 'held-only' && scoredChannels[channel] !== 'posture'
    record(
      channel,
      eventDelta(run, channel, pulse, gate),
      paired && pairedPulse !== null ? eventDelta(paired, channel, pairedPulse, gate) : null,
      withTrajectory ? releaseTrajectory(run, channel, pulse, gate) : undefined,
      withTrajectory && paired && pairedPulse !== null ? releaseTrajectory(paired, channel, pairedPulse, gate) : undefined,
    )
  }
  return { trialId, emotion, band, variant, side, rejected, releaseStart, faceResidue: naturalFaceResidue(settings, band), channels, missing }
}

/** Unpaired placebo deltas of every scenario `placebo` event in an emotion-free run. */
export function measurePlacebos(trace: NaturalTrace, gate: EmotionGate): PlaceboRecord[] {
  assertTrace(trace, 'placebo')
  return sortedEvents(trace).flatMap((entry) => {
    if (entry.source !== 'scenario' || entry.event.kind !== 'placebo')
      return []
    const channels: PlaceboRecord['channels'] = {}
    for (const channel of faceAndPosture) {
      const delta = eventDelta(trace, channel, entry.t, gate)
      if (typeof delta === 'number')
        channels[channel] = delta
    }
    return [{ id: entry.event.trialId ?? `placebo-${entry.t}`, channels }]
  })
}

// --- Expected values ---------------------------------------------------------------------------

/** Mean over `[a, b]` of the first-order step response `1 - exp(-(t - delay) / tau)`. */
function onsetFactor(tau: number, [a, b]: TimeWindow, delay = 0) {
  if (tau === 0)
    return 1
  return 1 - tau / (b - a) * (Math.exp(-(a - delay) / tau) - Math.exp(-(b - delay) / tau))
}

/** Body follows the head at these gains (`body.ts` `gain`), with a mean lag of 0.225 s (`drawLag`, 0.15-0.3 s). */
const bodyGain = { bodyAngleX: 0.99, bodyAngleY: 0.99, bodyAngleZ: 0.6 } as const
const bodyMeanLag = 0.225

export interface ExpectedEffect {
  /** Expected signed effect in the check's units, after clamping; `null` when the rig leaves no headroom. */
  value: number | null
  clamped: boolean
}

/**
 * Expected held-only effect: recipe x band nominal x adapter gain x onset factor, clamped to the rig range at
 * the channel default. Adapter gains (`natural-motion-adapter.ts`):
 * - face offsets (`composeFace`): written as `base + value * (max - min) / 2`, so 1 in half-range units;
 * - mouth opening (`composeFace`): written as `base + silentMouthOpen`, so `1 / halfRange`;
 * - eyelid (`composeEyelid`): `base * multiplier + hint` on an open lid, reported as `log(lid / base)`;
 * - head (`composePosture`): `neutral + command * (max - neutral)`, so `(max - neutral) / halfRange`;
 * - body: the head gain times the body follower gain (`body.ts`).
 * Onset factors are the mean step response over the class window: face and eyelid use `held.onsetTau` (0.989 on
 * [0.5, 3.5] s at the default 0.25 s), posture uses `held.postureTau` (0.990 on [2, 4] s at 0.6 s; the body adds its
 * mean follower lag). The mood afterglow is not part of the expectation.
 * Modulation checks have no size criterion; their `value` is the log ratio at the nominal strength.
 */
export function expectedEffect(check: ChannelCheck, settings: ExpressionPerformanceSettings, ranges: ParameterRanges, gate: EmotionGate): ExpectedEffect {
  const nominal = settings.intensity[check.band]
  const strength = check.recipe * nominal
  const face = onsetFactor(settings.held.onsetTau, gate.windows.face)
  if (check.cls === 'modulation') {
    if (check.channel === 'cameraFixation')
      return { value: null, clamped: false }
    const ratio = 1 + strength
    return { value: ratio > 0 ? (check.channel === 'blinkRate' ? -Math.log(ratio) : Math.log(ratio)) : null, clamped: false }
  }
  if (check.cls === 'eyelid') {
    const range = ranges.ParamEyeLOpen ?? ranges.ParamEyeROpen
    const base = range?.default ?? 1
    if (base <= 0.15)
      return { value: null, clamped: true }
    const lifted = base * (1 + strength * face) + (base > 0.2 ? (check.hint ?? 0) * nominal * face : 0)
    const lid = Math.max(lifted, Math.min(base, 0.2))
    const bounded = Math.min(range?.max ?? 1, Math.max(range?.min ?? 0, Math.max(0, Math.min(1, lid))))
    return bounded > 0 && bounded !== base
      ? { value: Math.log(bounded / base), clamped: bounded !== lid }
      : { value: null, clamped: true }
  }
  const raw = (id: string, normalizedValue: number) => {
    const range = ranges[id]
    const half = halfRange(ranges, id)
    if (!range || half === null)
      return { value: normalizedValue, clamped: false }
    const target = range.default + normalizedValue * half
    const bounded = Math.min(range.max, Math.max(range.min, target))
    return { value: (bounded - range.default) / half, clamped: bounded !== target }
  }
  let result: ExpectedEffect
  if (check.cls === 'posture') {
    const head = !check.channel.startsWith('body')
    const axisId = parameterIds[check.channel as keyof typeof parameterIds]
    const range = ranges[axisId]
    const half = halfRange(ranges, axisId)
    const command = strength * (head
      ? onsetFactor(settings.held.postureTau, gate.windows.posture)
      : bodyGain[check.channel as keyof typeof bodyGain] * onsetFactor(settings.held.postureTau, gate.windows.posture, bodyMeanLag))
    // composePosture maps the command around the neutral (default) value, not the range center.
    const gain = range && half !== null ? (command >= 0 ? range.max - range.default : range.default - range.min) / half : 1
    result = raw(axisId, command * gain)
  }
  else if (check.channel === 'mouthOpen') {
    const half = halfRange(ranges, 'ParamMouthOpenY') ?? 1
    result = raw('ParamMouthOpenY', strength * face / half)
  }
  else {
    const id = check.channel === 'browMean' || check.channel === 'browAsym' ? 'ParamBrowLY' : check.channel === 'browAngle' ? 'ParamBrowLAngle' : check.channel === 'eyeSmile' ? 'ParamEyeLSmile' : parameterIds[check.channel as keyof typeof parameterIds]
    result = raw(id, strength * face)
  }
  return Math.abs(result.value ?? 0) < 1e-9 ? { value: null, clamped: true } : result
}

// --- Aggregation -------------------------------------------------------------------------------

const classCriteria: Record<ChannelClass, readonly Criterion[]> = {
  face: ['significance', 'sign', 'size', 'visibility', 'release'],
  eyelid: ['significance', 'sign', 'size', 'visibility', 'release'],
  posture: ['significance', 'sign', 'size'],
  modulation: ['significance', 'sign', 'release'],
}

/** Criteria a check owns: posture is bias only (no visibility); only blink rate and breath period have a modulation release rule. */
function checkCriteria(check: ChannelCheck, requested: readonly Criterion[] | undefined) {
  const own = check.cls === 'modulation' && check.channel !== 'blinkRate' && check.channel !== 'breathPeriod'
    ? (['significance', 'sign'] as const)
    : classCriteria[check.cls]
  return own.filter(criterion => !requested || requested.includes(criterion))
}

const byKey = <T>(key: (value: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)

interface Evaluation {
  check: ChannelCheck
  result: CheckResult
  criteria: readonly Criterion[]
  /** Per-trial test values: `s * d`, or `|delta|` when unsigned. */
  tested: number[] | null
  /** Folded placebo null for unsigned checks. */
  folded: number[] | null
  /** Signed unpaired checks: raw trial values, their orientation signs, and the placebo pool they are tested against. */
  unpaired: { values: number[], signs: number[], reference: readonly number[] } | null
  /** Stratified unpaired checks: one stratum per capture session (folded values and signs of 1 when unsigned). */
  stratified: UnpairedStratum[] | null
  /** `true` pass, `false` fail, `null` not evaluable (the reason is in `result.reasons`). */
  outcomes: Partial<Record<Criterion, boolean | null>>
}

/**
 * Scores every check, then applies Holm across all significance tests of the run (family alpha from the gate).
 * Records are sorted by id first, so results do not depend on input order, and every resampling stream is seeded
 * from the gate id, version, and check key, so a check's p-value does not depend on which other checks ran.
 */
export function scoreEmotionGate(input: ScorerInput): EmotionGateScore {
  const { gate, ranges } = input
  const settings = input.settings ?? defaultExpressionPerformanceSettings
  const trials = [...input.trials].sort(byKey(trial => trial.trialId))
  const placebos = [...input.placebos].sort(byKey(placebo => placebo.id))
  const checks = [...input.checks].sort(byKey(check => check.key))
  const stream = (check: ChannelCheck, purpose: string) => createRandomStream(hashSeed(`${gate.id}@${gate.version}:${check.key}:${purpose}`))

  const nullValues = (channel: ScoredChannel, source: readonly PlaceboRecord[] = placebos) => source.flatMap(placebo => placebo.channels[channel] ?? [])
  const channelStats = (source: readonly PlaceboRecord[]) => {
    const stats: EmotionGateScore['nullStats'] = {}
    for (const channel of faceAndPosture) {
      const values = nullValues(channel, source)
      if (values.length)
        stats[channel] = { sigma0: sampleSd(values), q: quantile(values, gate.visibility.quantile), n: values.length }
    }
    return stats
  }
  const nullStats = channelStats(placebos)

  // Stratified scoring is all or nothing: a record without a stratum in a stratified run has no null to be scored against.
  const stratified = trials.some(trial => trial.stratum !== undefined) || placebos.some(placebo => placebo.stratum !== undefined)
  if (stratified && (trials.some(trial => trial.stratum === undefined) || placebos.some(placebo => placebo.stratum === undefined)))
    throw new Error('Stratified scoring needs a stratum on every trial and placebo record.')
  const strataKeys = stratified ? [...new Set(placebos.map(placebo => placebo.stratum!))].sort() : []
  const strataNullStats = stratified ? Object.fromEntries(strataKeys.map(key => [key, channelStats(placebos.filter(placebo => placebo.stratum === key))])) : undefined
  const placeboStrata = (channel: ScoredChannel) => stratified
    ? new Map(strataKeys.map(key => [key, nullValues(channel, placebos.filter(placebo => placebo.stratum === key))]))
    : null

  const evaluations = checks.map(check => evaluateCheck(check, { gate, settings, ranges, trials, placebo: nullValues(check.channel), placeboStrata: placeboStrata(check.channel), criteria: input.criteria, stream: purpose => stream(check, purpose) }))

  const tested = evaluations.filter(entry => entry.criteria.includes('significance') && entry.tested)
  for (const entry of tested) {
    const random = stream(entry.check, 'significance')
    entry.result.p = entry.stratified
      ? stratifiedUnpairedPValue(entry.stratified, gate.family.permutations, random)
      : entry.unpaired
        ? unpairedPValue(entry.unpaired.values, entry.unpaired.signs, entry.unpaired.reference, gate.family.permutations, random)
        : entry.folded
          ? twoSamplePValue(entry.tested!, entry.folded, gate.family.permutations, random)
          : signFlipPValue(entry.tested!, gate.family.permutations, random)
  }
  const adjusted = holmAdjust(tested.map(entry => entry.result.p!))
  tested.forEach((entry, index) => {
    entry.result.pHolm = adjusted[index]
    entry.outcomes.significance = adjusted[index] <= gate.family.alpha
  })

  for (const { result, criteria, outcomes } of evaluations) {
    for (const criterion of criteria) {
      if (outcomes[criterion] === false)
        result.failed.push(criterion)
    }
    const incomplete = !criteria.length || criteria.some(criterion => outcomes[criterion] === undefined || outcomes[criterion] === null)
    result.verdict = result.failed.length ? 'fail' : incomplete ? 'n/a' : 'pass'
  }

  const results = evaluations.map(entry => entry.result)
  return {
    gate: { id: gate.id, version: gate.version },
    limitation: gate.limitation,
    nullStats,
    ...(strataNullStats ? { strataNullStats } : {}),
    results,
    pass: results.length > 0 && results.every(result => result.verdict === 'pass'),
  }
}

interface EvaluationContext {
  gate: EmotionGate
  settings: ExpressionPerformanceSettings
  ranges: ParameterRanges
  trials: readonly EmotionTrialRecord[]
  /** Placebo deltas of this check's channel. */
  placebo: readonly number[]
  /** Stratified runs: the same deltas per stratum; `null` otherwise. */
  placeboStrata: ReadonlyMap<string, readonly number[]> | null
  criteria: readonly Criterion[] | undefined
  stream: (purpose: string) => RandomStream
}

/** Everything except significance, which needs the whole family for Holm. */
function evaluateCheck(check: ChannelCheck, context: EvaluationContext): Evaluation {
  const { gate, settings, ranges, placebo } = context
  const criteria = checkCriteria(check, context.criteria)
  const result: CheckResult = {
    key: check.key,
    emotion: check.emotion,
    band: check.band,
    channel: check.channel,
    unsigned: false,
    n: 0,
    rejected: 0,
    E: null,
    ci: null,
    d: null,
    hits: null,
    hitRate: null,
    p: null,
    pHolm: null,
    expected: null,
    sizeRatio: null,
    verdict: 'n/a',
    failed: [],
    reasons: [],
  }
  const evaluation: Evaluation = { check, result, criteria, tested: null, folded: null, unpaired: null, stratified: null, outcomes: {} }
  const { outcomes } = evaluation
  const notEvaluable = (criterion: Criterion, reason: string) => {
    if (criteria.includes(criterion)) {
      outcomes[criterion] = null
      result.reasons.push(`${criterion}: ${reason}`)
    }
  }

  // Records built elsewhere (or read back from JSON) get the same derived-value rule as `measureEmotionTrial`.
  const invalidMeasure = (trial: EmotionTrialRecord) => {
    const entry = trial.channels[check.channel]
    return entry ? derivedNonFiniteReason(check.channel, entry.value, entry.paired) : null
  }
  const usable = (variant: TrialVariant) => {
    const matching = context.trials.filter(trial => trial.emotion === check.emotion && trial.band === check.band && trial.variant === variant)
    for (const trial of matching) {
      if (trial.rejected !== null) {
        result.rejected++
        result.reasons.push(`${trial.trialId} rejected: ${trial.rejected}`)
      }
      else if (trial.missing[check.channel]) {
        result.reasons.push(`${trial.trialId} cannot measure ${check.channel}: ${trial.missing[check.channel]}`)
      }
      else if (invalidMeasure(trial)) {
        result.reasons.push(`${trial.trialId} cannot measure ${check.channel}: ${invalidMeasure(trial)}`)
      }
    }
    return matching.filter(trial => trial.rejected === null && trial.channels[check.channel] !== undefined && invalidMeasure(trial) === null)
  }
  const measure = (trial: EmotionTrialRecord) => trial.channels[check.channel]!
  const signOf = (trial: EmotionTrialRecord) => check.sign * (check.sided ? trial.side ?? 0 : 1)
  // Paired when every trial has its stripped run; then d = delta - delta0, otherwise d = delta.
  const differences = (list: EmotionTrialRecord[]) => {
    const paired = list.every(trial => measure(trial).paired !== null)
    return list.map(trial => signOf(trial) * (measure(trial).value - (paired ? measure(trial).paired! : 0)))
  }
  const sigma0 = placebo.length >= 2 ? sampleSd(placebo) : null
  const primaryVariant: TrialVariant = check.cls === 'modulation' ? 'long-hold' : 'full'
  const strata = context.placeboStrata
  // Stratified runs score a trial only against its own session's placebo windows, so a session without any is skipped.
  const primary = usable(primaryVariant).filter((trial) => {
    if (!strata || (strata.get(trial.stratum!)?.length ?? 0) > 0)
      return true
    result.reasons.push(`${trial.trialId} has no ${check.channel} placebo window in its session ${trial.stratum}`)
    return false
  })
  const unsigned = check.sided && primary.some(trial => trial.side === null)
  result.unsigned = unsigned
  result.n = primary.length

  // Effect, significance inputs, and sign.
  if (!primary.length) {
    notEvaluable('significance', `no usable ${primaryVariant} trials`)
    notEvaluable('sign', `no usable ${primaryVariant} trials`)
  }
  else if (check.cls === 'modulation' && primary.some(trial => measure(trial).paired === null)) {
    notEvaluable('significance', 'modulation needs the paired stripped run')
    notEvaluable('sign', 'modulation needs the paired stripped run')
  }
  else if (strata && primary.every(trial => measure(trial).paired === null)) {
    // Session-stratified unpaired: every trial against its own session's placebo windows (folded when unsigned), the
    // effect is the mean trial-minus-own-null difference, and the bootstrap resamples trials and placebos within sessions.
    const groups: UnpairedStratum[] = [...strata.keys()].flatMap((key) => {
      const own = primary.filter(trial => trial.stratum === key)
      const reference = strata.get(key)!
      return own.length
        ? [{ sample: own.map(trial => unsigned ? Math.abs(measure(trial).value) : measure(trial).value), signs: own.map(trial => unsigned ? 1 : signOf(trial)), reference: unsigned ? reference.map(Math.abs) : [...reference] }]
        : []
    })
    evaluation.stratified = groups
    evaluation.tested = groups.flatMap(group => group.sample.map((value, index) => group.signs[index] * value))
    result.E = stratifiedUnpairedEffect(groups)
    const random = context.stream('effect-ci')
    const draws: number[] = []
    for (let draw = 0; draw < gate.family.bootstrap; draw++) {
      draws.push(stratifiedUnpairedEffect(groups.map(({ sample, signs, reference }) => {
        const picks = sample.map(() => Math.floor(random() * sample.length))
        return { sample: picks.map(pick => sample[pick]), signs: picks.map(pick => signs[pick]), reference: reference.map(() => reference[Math.floor(random() * reference.length)]) }
      })))
    }
    result.ci = [quantile(draws, 0.025), quantile(draws, 0.975)]
    // Within-session spread: deviations from each session's own null mean, pooled over sessions.
    const deviations = groups.flatMap(({ reference }) => reference.map(value => value - mean(reference)))
    const degrees = deviations.length - groups.length
    const spread = degrees > 0 ? Math.sqrt(deviations.reduce((sum, value) => sum + value ** 2, 0) / degrees) : 0
    result.d = check.cls !== 'modulation' && spread ? result.E / spread : null
    if (criteria.includes('sign'))
      outcomes.sign = result.E > 0
  }
  else if (unsigned && !placebo.length) {
    notEvaluable('significance', 'an unsigned check needs placebo windows for the folded null')
    notEvaluable('sign', 'an unsigned check needs placebo windows for the folded null')
  }
  else if (!unsigned && placebo.length && !primary.every(trial => measure(trial).paired !== null)) {
    // Unpaired: the trial values are a second independent sample of the idle statistic, which need not be symmetric
    // or centered on zero, so they are compared with the placebo pool by a two-sample permutation test.
    const raw = primary.map(trial => measure(trial).value)
    const signs = primary.map(signOf)
    const meanSign = mean(signs)
    const values = raw.map((value, index) => signs[index] * value)
    evaluation.tested = values
    evaluation.unpaired = { values: raw, signs, reference: placebo }
    result.E = mean(values) - meanSign * mean(placebo)
    // The CI resamples (sign, value) pairs and the placebo pool, and recomputes the declared statistic per draw.
    const random = context.stream('effect-ci')
    const draws: number[] = []
    for (let draw = 0; draw < gate.family.bootstrap; draw++) {
      let trialSum = 0
      let signSum = 0
      for (let index = 0; index < values.length; index++) {
        const pick = Math.floor(random() * values.length)
        trialSum += values[pick]
        signSum += signs[pick]
      }
      let nullSum = 0
      for (let index = 0; index < placebo.length; index++)
        nullSum += placebo[Math.floor(random() * placebo.length)]
      draws.push(trialSum / values.length - signSum / values.length * nullSum / placebo.length)
    }
    result.ci = [quantile(draws, 0.025), quantile(draws, 0.975)]
    result.d = check.cls !== 'modulation' && sigma0 ? result.E / sigma0 : null
    if (criteria.includes('sign'))
      outcomes.sign = result.E > 0
  }
  else {
    // Without the hold side, |delta| is compared with the folded placebo null.
    const values = unsigned ? primary.map(trial => Math.abs(measure(trial).value)) : differences(primary)
    const folded = unsigned ? placebo.map(Math.abs) : null
    const offset = folded ? mean(folded) : 0
    evaluation.tested = values
    evaluation.folded = folded
    result.E = mean(values) - offset
    result.ci = bootstrapCi(values.length, gate.family.bootstrap, context.stream('effect-ci'), indices => mean(indices.map(index => values[index])) - offset)
    const spread = folded ? sampleSd(folded) : sigma0
    result.d = check.cls !== 'modulation' && spread ? result.E / spread : null
    if (criteria.includes('sign'))
      outcomes.sign = result.E > 0
  }

  // Visibility: per-trial hits above the placebo quantile of the signed (or folded) null.
  if (criteria.includes('visibility')) {
    if (!primary.length) {
      notEvaluable('visibility', 'no usable full trials')
    }
    else if (placebo.length < 2) {
      notEvaluable('visibility', 'fewer than two placebo windows')
    }
    else if (result.E === null) {
      notEvaluable('visibility', 'no measurable effect')
    }
    else if (evaluation.stratified && primary.some(trial => strata!.get(trial.stratum!)!.length < 2)) {
      notEvaluable('visibility', 'a session has fewer than two placebo windows')
    }
    else if (evaluation.stratified) {
      // Each trial against the visibility quantile of its own session's (signed or folded) null.
      const q = gate.visibility.quantile
      result.hits = primary.filter((trial) => {
        const own = strata!.get(trial.stratum!)!
        const value = measure(trial).value
        if (unsigned)
          return Math.abs(value) > quantile(own.map(Math.abs), q)
        const s = signOf(trial)
        return s * value > quantile(s >= 0 ? own : own.map(entry => -entry), q)
      }).length
      result.hitRate = result.hits / primary.length
      const rule = gate.visibility.bands[check.band]
      if (result.d === null)
        result.reasons.push('visibility: placebo null has zero spread at this level')
      const sizePass = result.d === null ? result.E > 0 : result.d >= rule.d
      outcomes.visibility = result.hitRate >= rule.hitRate && sizePass
    }
    else {
      const q = gate.visibility.quantile
      const folded = placebo.map(Math.abs)
      const raise = unsigned ? quantile(folded, q) : quantile(placebo, q)
      const lower = unsigned ? raise : quantile(placebo.map(value => -value), q)
      result.hits = primary.filter((trial) => {
        const value = measure(trial).value
        if (unsigned)
          return Math.abs(value) > raise
        const s = signOf(trial)
        return s * value > (s >= 0 ? raise : lower)
      }).length
      result.hitRate = result.hits / primary.length
      const rule = gate.visibility.bands[check.band]
      // A positive effect against a perfectly still null has unbounded standardized size.
      // Keep JSON finite while evaluating the limit E / sigma0 as sigma0 approaches zero.
      if (result.d === null)
        result.reasons.push('visibility: placebo null has zero spread at this level')
      const sizePass = result.d === null ? result.E > 0 : result.d >= rule.d
      outcomes.visibility = result.hitRate >= rule.hitRate && sizePass
    }
  }

  // Size: held-only paired effect over the expected value; clamped channels check only the lower bound.
  const heldOnly = check.cls === 'modulation' ? [] : usable('held-only')
  const heldUnsigned = check.sided && heldOnly.some(trial => trial.side === null)
  const heldEffect = !heldOnly.length
    ? null
    : heldUnsigned
      ? mean(heldOnly.map(trial => Math.abs(measure(trial).value))) - (placebo.length ? mean(placebo.map(Math.abs)) : 0)
      : mean(differences(heldOnly))
  const expected = expectedEffect(check, settings, ranges, gate)
  result.expected = expected.value
  if (criteria.includes('size')) {
    if (expected.value === null) {
      notEvaluable('size', 'the rig range leaves no headroom for the expected effect')
    }
    else if (heldEffect === null) {
      notEvaluable('size', 'no usable held-only trials')
    }
    else {
      result.sizeRatio = heldEffect / Math.abs(expected.value)
      if (expected.clamped)
        result.reasons.push('size: clamped channel, only the lower bound applies')
      outcomes.size = result.sizeRatio >= gate.size.ratio[0] && (expected.clamped || result.sizeRatio <= gate.size.ratio[1])
    }
  }

  if (criteria.includes('release')) {
    const release = check.cls === 'modulation'
      ? scoreModulationRelease(check, result, primary, gate)
      : scoreFaceRelease(check, result, heldOnly, { gate, settings, sigma0, signOf, effect: heldEffect, unsigned: heldUnsigned, random: context.stream('release') })
    outcomes.release = release
  }
  return evaluation
}

/** Blink rate and breath period after the long hold ends: pooled ratio to the paired null within `1 +- ratioTolerance`. */
function scoreModulationRelease(check: ChannelCheck, result: CheckResult, trials: readonly EmotionTrialRecord[], gate: EmotionGate): boolean | null {
  let run = 0
  let paired = 0
  let runIntervals = 0
  let pairedIntervals = 0
  for (const trial of trials) {
    const release = trial.modulationRelease
    if (check.channel === 'blinkRate' && release && release.blinks.paired !== null) {
      run += release.blinks.run
      paired += release.blinks.paired
    }
    if (check.channel === 'breathPeriod' && release?.breath.paired) {
      run += release.breath.run.total
      runIntervals += release.breath.run.intervals
      paired += release.breath.paired.total
      pairedIntervals += release.breath.paired.intervals
    }
  }
  // Equal window lengths make the pooled blink-count ratio the rate ratio; breath pools total time over intervals.
  const ratio = check.channel === 'breathPeriod'
    ? (runIntervals && pairedIntervals && paired > 0 ? (run / runIntervals) / (paired / pairedIntervals) : null)
    : (paired > 0 ? run / paired : null)
  result.residual = { c: null, A: null, late: null, lateCi: null, ratio }
  if (ratio === null) {
    result.reasons.push('release: no paired long-hold release windows')
    return null
  }
  return Math.abs(ratio - 1) <= gate.release.ratioTolerance
}

/**
 * Face and eyelid release on the held-only variant. A trial counts only when its face residue (impulse hints,
 * glance; `naturalFaceResidue`) has ended by the start of the fit window, so the trajectory shows
 * the hold's release alone. Posture is not released here: it decays with `held.postureTau`, and gesture clips
 * (up to 7.5 s) write head and body during the window.
 */
function scoreFaceRelease(
  check: ChannelCheck,
  result: CheckResult,
  trials: readonly EmotionTrialRecord[],
  context: { gate: EmotionGate, settings: ExpressionPerformanceSettings, sigma0: number | null, signOf: (trial: EmotionTrialRecord) => number, effect: number | null, unsigned: boolean, random: RandomStream },
): boolean | null {
  const { gate, settings, sigma0, signOf, random } = context
  result.residual = { c: null, A: null, late: null, lateCi: null }
  result.tau = null
  result.tauCi = null
  if (context.unsigned) {
    result.reasons.push('release: needs the hold side')
    return null
  }
  const releaseStart = gate.release.window[0]
  const clean = trials.filter(trial => trial.faceResidue <= releaseStart + 1e-9 && trial.channels[check.channel]?.trajectory)
  if (clean.length < trials.length)
    result.reasons.push(`release: ${trials.length - clean.length} held-only trials skipped (impulse residue overlaps the window, or no trajectory)`)
  if (!clean.length) {
    result.reasons.push('release: no held-only trial whose fit window starts after the impulse residue')
    return null
  }
  const signed = clean.map(trial => trial.channels[check.channel]!.trajectory!.map(value => signOf(trial) * value))
  const grid = releaseGrid(gate)
  const [lateStart, lateEnd] = gate.release.late
  const lateIndices = grid.flatMap((time, index) => time >= lateStart - 1e-9 && time <= lateEnd + 1e-9 ? [index] : [])
  const meanTrajectory = (indices: readonly number[]) => grid.map((_, point) => mean(indices.map(index => signed[index][point])))
  const lateMean = (trajectory: readonly number[]) => mean(lateIndices.map(index => trajectory[index]))
  const all = signed.map((_, index) => index)
  const fit = fitExponential(grid, meanTrajectory(all), releaseStart)
  const taus: number[] = []
  const lates: number[] = []
  const indices = Array.from<number>({ length: signed.length })
  for (let draw = 0; draw < gate.family.bootstrap; draw++) {
    for (let index = 0; index < signed.length; index++)
      indices[index] = Math.floor(random() * signed.length)
    const trajectory = meanTrajectory(indices)
    taus.push(fitExponential(grid, trajectory, releaseStart).tau)
    lates.push(lateMean(trajectory))
  }
  result.tau = fit.tau
  result.tauCi = [quantile(taus, 0.025), quantile(taus, 0.975)]
  result.residual = { c: fit.c, A: fit.A, late: lateMean(meanTrajectory(all)), lateCi: [quantile(lates, 0.025), quantile(lates, 0.975)] }

  // Judged against the committed nominal tau, never the run's own (possibly mutated) settings.
  const nominal = settings.held.releaseTau
  const excluded = gate.release.tauExcluded * nominal
  const tolerance = Math.max(gate.release.lateEffectShare * Math.abs(context.effect ?? fit.A), gate.release.lateNoiseShare * (sigma0 ?? 0))
  const failures = [
    (!(fit.tau >= gate.release.tauRatio[0] * nominal) || !(fit.tau <= gate.release.tauRatio[1] * nominal)) && `tau ${fit.tau} outside [${gate.release.tauRatio[0]}, ${gate.release.tauRatio[1]}] x ${nominal}`,
    result.tauCi[0] <= excluded && excluded <= result.tauCi[1] && `tau CI includes ${gate.release.tauExcluded} x nominal`,
    !(Math.abs(fit.c) <= gate.release.offsetShare * fit.A) && `|c| ${Math.abs(fit.c)} above ${gate.release.offsetShare} x A ${fit.A}`,
    (!(result.residual.lateCi![0] >= -tolerance) || !(result.residual.lateCi![1] <= tolerance)) && `late-window CI outside +-${tolerance}`,
  ].filter((failure): failure is string => typeof failure === 'string')
  for (const failure of failures)
    result.reasons.push(`release: ${failure}`)
  return failures.length === 0
}
