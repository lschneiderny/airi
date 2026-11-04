import type { CharacterReading, FaceBaseline } from './types'

import { CHARACTER_STATE_SETTINGS } from './settings'

const FACE = CHARACTER_STATE_SETTINGS.face
/**
 * A mood this close to the resting disposition counts as equal to it. `moodAt` squashes through `tanh(atanh(T))`,
 * which leaves a resting mood a few ulps off its resting value; without the snap the driver would get a non-zero
 * offset and lose its bit-identical neutral output.
 */
const RESTING_TOLERANCE = 1e-9

/** Every offset neutral; the Natural driver leaves its output bit-identical with it. */
export const NEUTRAL_FACE_BASELINE: FaceBaseline = Object.freeze({ mouthForm: 0, eyeOpen: 0, blinkRateOffset: 0, browAngle: 0 })

function offset(value: number, resting: number): number {
  const distance = value - resting
  return Math.abs(distance) < RESTING_TOLERANCE ? 0 : distance
}

function clamp(value: number, limit: number): number {
  // `+ 0` turns a negative zero into 0, so a resting mood yields exactly the neutral baseline.
  return Math.min(limit, Math.max(-limit, value)) + 0
}

/**
 * Damping of the face baseline by the time since the last interaction (A9):
 * `D(τ) = 0.25 + 0.75 · 2^(-max(0, τ - 2 min) / 20 min)`. No interaction yet gives the floor; an interaction stamped
 * after `nowMs` counts as just now.
 */
export function faceDamping(lastInteractionAtMs: number | null, nowMs: number): number {
  const { floor, graceMs, halfLifeMs } = FACE.damping
  if (lastInteractionAtMs === null)
    return floor
  const tau = Math.max(0, nowMs - lastInteractionAtMs)
  return floor + (1 - floor) * 2 ** (-Math.max(0, tau - graceMs) / halfLifeMs)
}

/**
 * The resting-face offsets of a reading at `nowMs` (plan Appendix A9), from the mood's distance to the resting
 * disposition, damped by {@link faceDamping}: mouth form follows valence, eye openness and blink rate follow energy,
 * and the worried brow (positive `browAngle`) follows tension. Each offset stays within 35% of its channel range, and
 * the blink rate offset within ±0.4. No reading or a non-finite `nowMs` gives {@link NEUTRAL_FACE_BASELINE}.
 */
export function faceBaselineOf(reading: Pick<CharacterReading, 'mood' | 'resting' | 'lastInteractionAtMs'> | null, nowMs: number): FaceBaseline {
  if (reading === null || !Number.isFinite(nowMs))
    return NEUTRAL_FACE_BASELINE
  const { gains, channelShare, channelRanges, blinkRateOffsetClamp } = FACE
  const damping = faceDamping(reading.lastInteractionAtMs, nowMs)
  const valence = offset(reading.mood.valence, reading.resting.valence) * damping
  const energy = offset(reading.mood.energy, reading.resting.energy) * damping
  const tension = offset(reading.mood.tension, reading.resting.tension) * damping
  return {
    mouthForm: clamp(gains.mouthForm * valence, channelShare * channelRanges.mouthForm),
    eyeOpen: clamp(gains.eyeOpen * energy, channelShare * channelRanges.eyeOpen),
    blinkRateOffset: clamp(gains.blinkRateOffset * energy, blinkRateOffsetClamp),
    browAngle: clamp(gains.browAngle * tension, channelShare * channelRanges.browAngle),
  }
}
