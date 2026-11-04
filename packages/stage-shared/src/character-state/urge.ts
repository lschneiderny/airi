import type { MoodAxes, MoodSource } from './types'

import { CHARACTER_STATE_SETTINGS } from './settings'

const URGE = CHARACTER_STATE_SETTINGS.urge

/**
 * The multiplier of the reach-out open hazard (plan Appendix A8):
 * `exp(clamp(0.35 v + 0.15 e - 0.2 max(0, t - 0.3), -0.4, 0.3))`, so it lies in [0.67, 1.35] and is 1 at a neutral mood.
 */
export function urgeFactorOf(mood: MoodAxes): number {
  const { weights, tensionFloor, exponent } = URGE
  const raw = weights.valence * mood.valence + weights.energy * mood.energy - weights.tension * Math.max(0, mood.tension - tensionFloor)
  return Math.exp(Math.min(exponent.max, Math.max(exponent.min, raw)))
}

/**
 * Whether an unprompted turn should say one plain thing about how she feels (A8): valence at most -0.2, tension at
 * least 0.35, and an unanswered reach-out among the shown reasons, given by their sources.
 */
export function pointedOf(mood: MoodAxes, shownSources: readonly MoodSource[]): boolean {
  const { maxValence, minTension } = URGE.pointed
  return mood.valence <= maxValence && mood.tension >= minTension && shownSources.includes('reach-out-unanswered')
}
