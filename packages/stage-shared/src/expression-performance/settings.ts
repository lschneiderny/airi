import type { InferOutput, ObjectEntries } from 'valibot'

import { boolean, check, finite, integer, maxValue, minValue, nullable, number, optional, parse, picklist, pipe, safeParse, strictObject, unknown } from 'valibot'

function settingsObject<T extends ObjectEntries>(entries: T) {
  // Valibot objects accept arrays; settings documents and sections must be records.
  return pipe(unknown(), check(value => !Array.isArray(value), 'Expected a settings object'), strictObject(entries))
}

const unit = () => pipe(number(), finite(), minValue(0), maxValue(1))
const seconds = () => pipe(number(), finite(), minValue(0))
const within = ([min, max]: NumberRange) => pipe(number(), finite(), minValue(min), maxValue(max))

/** Inclusive `[min, max]` bounds. */
export type NumberRange = readonly [min: number, max: number]

/**
 * Multiplies a non-negative persisted value by a non-negative profile scale and keeps the product finite.
 * A product above Number.MAX_VALUE is clamped to it, so effective settings and recorded traces never hold
 * Infinity (JSON would export it as null). Only values near the float limit, such as taus above 1e300, reach the
 * clamp, and they already mean "never" either way. A product that underflows becomes 0.
 */
export function scaleFinite(value: number, scale: number): number {
  return Math.min(value * scale, Number.MAX_VALUE)
}

/** Bounds of `scaleFinite` over two non-negative ranges, such as a persisted value and a profile scale. */
export function scaleRange([min, max]: NumberRange, [scaleMin, scaleMax]: NumberRange): NumberRange {
  return [scaleFinite(min, scaleMin), scaleFinite(max, scaleMax)]
}

/** Persisted mood dose bounds. */
export const moodGainRange: NumberRange = [0, 1]
/** Persisted mood decay bounds in seconds: any finite non-negative value. */
export const moodTauRange: NumberRange = [0, Number.MAX_VALUE]

const intensitySchema = settingsObject({
  /** Nominal dose; 0 is neutral. @default 0.25 */
  slight: optional(unit(), 0.25),
  /** Nominal dose; 0 is neutral. @default 0.6 */
  clear: optional(unit(), 0.6),
  /** Nominal dose; 0 is neutral. @default 0.9 */
  strong: optional(unit(), 0.9),
  /** Lower clear threshold; 0 admits every positive dose. @default 0.5 */
  clearFrom: optional(unit(), 0.5),
  /** Lower strong threshold; 0 admits every positive dose. @default 0.8 */
  strongFrom: optional(unit(), 0.8),
  /** Dose variation; 0 disables jitter. @default 0.04 */
  jitter: optional(unit(), 0.04),
  /** History seconds; 0 disables history. @default 15 */
  habituationWindow: optional(seconds(), 15),
  /** Repeat multiplier; 1 preserves dose. @default 0.8 */
  habituationBase: optional(unit(), 0.8),
  /** Minimum repeat multiplier; 1 preserves dose. @default 0.35 */
  habituationFloor: optional(unit(), 0.35),
  /** Escalation window seconds; 0 disables merging repeats. @default 2 */
  escalationWindow: optional(seconds(), 2),
})

function naturalBandSchema(onset: number, head: number | null, overshoot: number, hold: number, release: number) {
  return settingsObject({
    /** Face onset seconds; 0 is immediate. */
    faceOnsetTau: optional(seconds(), onset),
    /** Head response seconds; null disables head recruitment, 0 is immediate. */
    headTau: optional(nullable(seconds()), head),
    /** Head overshoot; 0 disables overshoot. */
    overshoot: optional(unit(), overshoot),
    /** Face hold seconds; 0 has no hold. */
    faceHold: optional(seconds(), hold),
    /** Face release seconds; 0 is immediate. */
    faceReleaseTau: optional(seconds(), release),
  })
}
const slightSchema = naturalBandSchema(0.14, null, 0, 0.6, 0.35)
const clearSchema = naturalBandSchema(0.1, 0.38, 0.08, 1.2, 0.5)
const strongSchema = naturalBandSchema(0.07, 0.24, 0.16, 1.8, 0.7)
const naturalBandsSchema = settingsObject({
  /** Face-only recruitment; zero gains/holds and null head are neutral. */
  slight: optional(slightSchema, () => parse(slightSchema, {})),
  /** Face and head recruitment; zero gains/holds and null head are neutral. */
  clear: optional(clearSchema, () => parse(clearSchema, {})),
  /** Full recruitment; zero gains/holds and null head are neutral. */
  strong: optional(strongSchema, () => parse(strongSchema, {})),
  /** Head amplitude; 0 disables it. @default 0.12 */
  headGain: optional(unit(), 0.12),
  /** Body amplitude; 0 disables it. @default 0.06 */
  bodyGain: optional(unit(), 0.06),
})
function moodDynamicsSchema(bounds: MoodBounds) {
  const gain = () => within(bounds.gain)
  const tau = () => within(bounds.tau)
  return settingsObject({
    /** Valence decay seconds; 0 releases immediately. @default 45 */
    valenceTau: optional(tau(), 45),
    /** Arousal decay seconds; 0 releases immediately. @default 20 */
    arousalTau: optional(tau(), 20),
    /** Tension decay seconds; 0 releases immediately. @default 30 */
    tensionTau: optional(tau(), 30),
    /** Slight mood dose; 0 is neutral. @default 0.15 */
    slightGain: optional(gain(), 0.15),
    /** Clear mood dose; 0 is neutral. @default 0.25 */
    clearGain: optional(gain(), 0.25),
    /** Strong mood dose; 0 is neutral. @default 0.4 */
    strongGain: optional(gain(), 0.4),
    /** Amplitude modulation; 0 preserves idle. @default 0.2 */
    amplitude: optional(unit(), 0.2),
    /** Shift-rate modulation; 0 preserves idle. @default 0.3 */
    shiftRate: optional(unit(), 0.3),
    /** Valence camera bias; 0 preserves gaze. @default 0.1 */
    cameraValence: optional(unit(), 0.1),
    /** Tension camera bias; 0 preserves gaze. @default 0.15 */
    cameraTension: optional(unit(), 0.15),
    /** Speech emphasis addition; 0 preserves emphasis. @default 0.1 */
    emphasis: optional(unit(), 0.1),
    /** Mouth form addition; 0 preserves mouth form. @default 0.08 */
    mouthForm: optional(unit(), 0.08),
  })
}
const pickerSchema = settingsObject({
  /** Recency penalty; 0 preserves mapping weights. @default 0.8 */
  recencyDepth: optional(unit(), 0.8),
  /** Recency decay seconds; 0 forgets immediately. @default 8 */
  recencyTau: optional(seconds(), 8),
  /** Effect gate lower threshold; 0 starts gating at neutral. @default 0.5 */
  effectGateFrom: optional(unit(), 0.5),
  /** Effect gate upper threshold; 0 admits all positive doses. @default 0.8 */
  effectGateTo: optional(unit(), 0.8),
})
const slotsSchema = settingsObject({
  /** Fade seconds; 0 switches immediately. @default 1 */
  defaultFadeSeconds: optional(seconds(), 1),
  /** Speech release grace seconds; 0 adds no grace. @default 0.25 */
  speechGrace: optional(seconds(), 0.25),
  /** Unstarted lease lifetime seconds; 0 expires immediately. @default 10 */
  unstartedExpiry: optional(seconds(), 10),
  /** Maximum hold seconds; 0 prevents holding. @default 15 */
  holdCap: optional(seconds(), 15),
})
const timingSchema = settingsObject({
  /** Silence needed for a pause event; 0 is immediate. @default 0.18 */
  pauseSeconds: optional(seconds(), 0.18),
  /** Emphasis refractory seconds; 0 allows every onset. @default 1.2 */
  emphasisRefractory: optional(seconds(), 1.2),
})

const heldSchema = settingsObject({
  /** Seconds a turnless emotion is held; 0 releases at once. @default 4 */
  turnlessSeconds: optional(seconds(), 4),
  /** Held-emotion onset seconds; 0 is immediate. @default 0.25 */
  onsetTau: optional(seconds(), 0.25),
  /** Held-emotion release seconds; 0 is immediate. @default 0.6 */
  releaseTau: optional(seconds(), 0.6),
  /** Accent scale on top of a hold; 0 disables accents. @default 0.5 */
  accentScale: optional(unit(), 0.5),
  /** Posture response seconds; 0 is immediate. @default 0.6 */
  postureTau: optional(seconds(), 0.6),
})

const plannerSchema = settingsObject({
  /**
   * Seconds between automatic performance moments; 0 allows back-to-back changes. The face and effect
   * changes emitted by one decision share one moment and change together, while `windowMax` still
   * counts each slot change. @default 0.8
   */
  minGap: optional(seconds(), 0.8),
  /** Budget window seconds; 0 disables the per-window cap. @default 5 */
  window: optional(seconds(), 5),
  /** Automatic slot changes allowed within any window, counted per slot; the cap is off when window is 0. @default 3 */
  windowMax: optional(pipe(number(), integer(), minValue(1)), 3),
  /** Seconds a scheduled pick waits for its timing slot before its deadline emits it; 0 emits it at the next deadline. @default 6 */
  scheduleExpiry: optional(seconds(), 6),
})

/** Bounds of the profile-scaled mood fields; every other field has fixed bounds. */
export interface MoodBounds {
  gain: NumberRange
  tau: NumberRange
}

/**
 * Builds the settings document schema. Persisted documents use `moodGainRange` and `moodTauRange`; effective documents
 * use those ranges scaled by the profile ranges (see `EffectiveExpressionPerformanceSettingsSchema`).
 */
export function createExpressionPerformanceSettingsSchema(mood: MoodBounds) {
  const moodDynamics = moodDynamicsSchema(mood)
  return settingsObject({
    /** False bypasses band recruitment. @default true */
    bands: optional(boolean(), true),
    /** False preserves idle without mood modulation. @default true */
    mood: optional(boolean(), true),
    /** False disables automatic expression selection. @default true */
    autoExpressions: optional(boolean(), true),
    /** False omits active-expression feedback. @default false */
    stateFeedback: optional(boolean(), false),
    /** False keeps today's momentary emotion behavior. @default true */
    heldEmotions: optional(boolean(), true),
    /** Picker emits picks at once; planner schedules them into speech timing slots under a change budget. @default 'picker' */
    decider: optional(picklist(['picker', 'planner']), 'picker'),
    /** Zero dose/jitter and unit habituation preserve neutral intensity. */
    intensity: optional(intensitySchema, () => parse(intensitySchema, {})),
    /** Zero modulation gains preserve idle motion. */
    naturalBands: optional(naturalBandsSchema, () => parse(naturalBandsSchema, {})),
    /** Zero mood gains preserve idle motion. */
    moodDynamics: optional(moodDynamics, () => parse(moodDynamics, {})),
    /** Zero recency depth preserves mapping weights. */
    picker: optional(pickerSchema, () => parse(pickerSchema, {})),
    /** Zero durations remove additional lifetime and fades. */
    slots: optional(slotsSchema, () => parse(slotsSchema, {})),
    /** Zero durations remove timing delays. */
    timing: optional(timingSchema, () => parse(timingSchema, {})),
    /** Held-emotion dynamics; ignored when `heldEmotions` is false. */
    held: optional(heldSchema, () => parse(heldSchema, {})),
    /** Zero gap and window disable the planner budget; zero expiry stops picks from waiting for timing slots. */
    planner: optional(plannerSchema, () => parse(plannerSchema, {})),
  })
}

export const ExpressionPerformanceSettingsSchema = createExpressionPerformanceSettingsSchema({ gain: moodGainRange, tau: moodTauRange })
export type ExpressionPerformanceSettings = InferOutput<typeof ExpressionPerformanceSettingsSchema>
export const defaultExpressionPerformanceSettings = parse(ExpressionPerformanceSettingsSchema, {})

/** Invalid documents return a fresh default document and issues for the caller to log. */
export function parseExpressionPerformanceSettings(input: unknown) {
  const result = safeParse(ExpressionPerformanceSettingsSchema, input)
  return result.success
    ? { success: true as const, value: result.output }
    : { success: false as const, value: parse(ExpressionPerformanceSettingsSchema, {}), issues: result.issues }
}
