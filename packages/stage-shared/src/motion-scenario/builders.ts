import type { Band, PerformanceEmotion } from '../expression-performance/types'
import type { MotionScenario } from './schema'

import { parse } from 'valibot'

import { MotionScenarioSchema } from './schema'

const allLevels: MotionScenario['levels'] = ['t1', 't2', 't3']

export interface PointerStrokeOptions {
  at: number
  durationSeconds: number
  rateHz: number
  amplitude: number
  speed: number
  axis: 'x' | 'y'
  center?: { x: number, y: number }
}

/** Build sampled pointer moves along a triangle-wave stroke, including both endpoints. */
export function buildPointerStroke(options: PointerStrokeOptions): MotionScenario['events'] {
  const { at, durationSeconds, rateHz, amplitude, speed, axis, center = { x: 0, y: 0 } } = options
  const sampleCount = Math.ceil(durationSeconds * rateHz)
  const period = 4 * amplitude / speed
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const elapsed = Math.min(index / rateHz, durationSeconds)
    const phase = ((elapsed % period) / period) * 4
    const offset = phase <= 2 ? -amplitude + phase * amplitude : amplitude - (phase - 2) * amplitude
    return {
      kind: 'pointer' as const,
      at: at + elapsed,
      phase: 'move' as const,
      x: center.x + (axis === 'x' ? offset : 0),
      y: center.y + (axis === 'y' ? offset : 0),
    }
  })
}

export interface PointerApproachOptions {
  at: number
  from: 'left' | 'right' | 'top' | 'bottom'
  startDistance: number
  endDistance: number
  speed: number
  rateHz: number
}

/** Build sampled pointer moves on a straight path from a side toward the head center. */
export function buildPointerApproach(options: PointerApproachOptions): MotionScenario['events'] {
  const { at, from, startDistance, endDistance, speed, rateHz } = options
  const duration = (startDistance - endDistance) / speed
  const sampleCount = Math.ceil(duration * rateHz)
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const elapsed = Math.min(index / rateHz, duration)
    const distance = index === sampleCount ? endDistance : startDistance - speed * elapsed
    const coordinate = from === 'left' || from === 'top' ? -distance : distance
    return {
      kind: 'pointer' as const,
      at: at + elapsed,
      phase: 'move' as const,
      x: from === 'left' || from === 'right' ? coordinate : 0,
      y: from === 'top' || from === 'bottom' ? coordinate : 0,
    }
  })
}

export interface PointerPokeOptions {
  at: number
  x: number
  y: number
  holdSeconds: number
}

/** Build a pointer press and release at one head-relative position. */
export function buildPointerPoke(options: PointerPokeOptions): MotionScenario['events'] {
  const { at, x, y, holdSeconds } = options
  return [
    { kind: 'pointer', at, phase: 'down', x, y },
    { kind: 'pointer', at: at + holdSeconds, phase: 'up', x, y },
  ]
}

/**
 * Settings that remove the pulse-driven recruitment while keeping the held emotion: no head recruitment, no body or
 * head gain, and no face hold or release hint. A `held-only` trial therefore shows the hold alone, so its release is
 * not contaminated by impulse or gesture residue. Field names: `naturalBands` in expression-performance/settings.ts.
 */
const heldOnlyBand = { headTau: null, overshoot: 0, faceHold: 0, faceReleaseTau: 0 }
const heldOnlyPerformance = {
  naturalBands: { slight: heldOnlyBand, clear: heldOnlyBand, strong: heldOnlyBand, headGain: 0, bodyGain: 0 },
}

export interface EmotionTrialOptions {
  emotion: PerformanceEmotion
  band: Band
  /** `full` runs the default recipe; `held-only` neutralizes head and face recruitment. */
  variant: 'full' | 'held-only'
  seed: number
  /** Seconds of idle before the pulse. @default 20 */
  warmup?: number
  /** Seconds the turnless hold lasts. @default 4 */
  hold?: number
  /** Seconds recorded after the hold ends. @default 6 */
  post?: number
}

/** One emotion pulse after a warm-up, held for `hold` seconds, then released. */
export function buildEmotionTrial(options: EmotionTrialOptions): MotionScenario {
  const { emotion, band, variant, seed, warmup = 20, hold = 4, post = 6 } = options
  const trialId = `${emotion}-${band}-${variant}-${seed}`
  return parse(MotionScenarioSchema, {
    version: 1,
    id: `emotion-trial-${trialId}`,
    seed,
    durationSeconds: warmup + hold + post,
    levels: allLevels,
    settings: { performance: { held: { turnlessSeconds: hold }, ...(variant === 'held-only' ? heldOnlyPerformance : {}) } },
    events: [{ kind: 'emotion', at: warmup, emotion, band, source: 'devtools', trialId }],
  })
}

export interface IdleWithPlaceboOptions {
  seed: number
  /** Seconds of idle before the first placebo. @default 20 */
  warmup?: number
  /** Number of placebo marks. @default 10 */
  placebos?: number
  /** Seconds between placebo marks. @default 6 */
  spacing?: number
}

/** Idle run with evenly spaced placebo marks; their windows form the unpaired noise null. */
export function buildIdleWithPlacebos(options: IdleWithPlaceboOptions): MotionScenario {
  const { seed, warmup = 20, placebos = 10, spacing = 6 } = options
  return parse(MotionScenarioSchema, {
    version: 1,
    id: `idle-placebos-${seed}`,
    seed,
    durationSeconds: warmup + placebos * spacing,
    levels: allLevels,
    events: Array.from({ length: placebos }, (_, index) => ({ kind: 'placebo', at: warmup + index * spacing, trialId: `placebo-${seed}-${index}` })),
  })
}

export interface LongHoldOptions {
  emotion: PerformanceEmotion
  band: Band
  seed: number
  /** Seconds the hold lasts (`held.turnlessSeconds`). @default 60 */
  seconds?: number
  /** Seconds of idle before the pulse. @default 20 */
  warmup?: number
  /** Seconds recorded after release, enough for the 30 s release window. @default 30 */
  post?: number
}

/** One emotion held for a long turnless hold, for slow-modulation checks (blink rate, breath, fixation). */
export function buildLongHold(options: LongHoldOptions): MotionScenario {
  const { emotion, band, seed, seconds = 60, warmup = 20, post = 30 } = options
  const trialId = `${emotion}-${band}-long-hold-${seed}`
  return parse(MotionScenarioSchema, {
    version: 1,
    id: `long-hold-${trialId}`,
    seed,
    durationSeconds: warmup + seconds + post,
    levels: allLevels,
    settings: { performance: { held: { turnlessSeconds: seconds }, slots: { holdCap: seconds } } },
    events: [{ kind: 'emotion', at: warmup, emotion, band, source: 'devtools', trialId }],
  })
}
