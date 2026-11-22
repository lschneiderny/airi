import type { ExpressionPerformanceSettings, MoodDose, ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import type { PlayedGesture } from './emotions'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/**
 * An episode as the Natural performer consumes it. `gesture` is the body gesture the character mind ordered for the
 * episode (`emotion-gesture`); without it the episode plays no gesture. The episode doses no mood: the mind sends its
 * dose as a separate `MoodDose`.
 */
export interface NaturalEpisode extends ReactionEpisode {
  gesture?: PlayedGesture
}

/**
 * Active-time afterglow of the doses the character mind decided. The mind keeps her mood once per character and seeds
 * a new controller with `set`; this copy decays on Natural's active seconds and drives the modulation readouts.
 */
export class NaturalMood {
  valence = 0
  arousal = 0
  tension = 0
  private settings = defaultExpressionPerformanceSettings.moodDynamics
  private readonly doseIds = new Set<string>()

  setPerformanceSettings(settings: ExpressionPerformanceSettings['moodDynamics']) {
    this.settings = { ...settings }
  }

  get active() {
    return this.valence !== 0 || this.arousal !== 0 || this.tension !== 0
  }

  /** Applies each external dose once for this controller's lifetime, independently of episode escalation. */
  addDose(dose: MoodDose) {
    if (this.doseIds.has(dose.id) || ![dose.valence, dose.arousal, dose.tension].every(Number.isFinite))
      return
    this.doseIds.add(dose.id)
    this.valence = clamp(this.valence + dose.valence, -1, 1)
    this.arousal = clamp(this.arousal + dose.arousal, -1, 1)
    this.tension = clamp(this.tension + dose.tension, 0, 1)
  }

  /** Replaces the level with the mind's seed, clamped; a malformed seed leaves the level. Dose ids stay applied. */
  set(level: Omit<MoodDose, 'id'>) {
    if (![level.valence, level.arousal, level.tension].every(Number.isFinite))
      return
    this.valence = clamp(level.valence, -1, 1)
    this.arousal = clamp(level.arousal, -1, 1)
    this.tension = clamp(level.tension, 0, 1)
  }

  /** Invalid or nonpositive steps leave state untouched; zero tau releases on the next positive step. */
  step(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0)
      return
    this.valence = this.settings.valenceTau === 0 ? 0 : this.valence * Math.exp(-dt / this.settings.valenceTau)
    this.arousal = this.settings.arousalTau === 0 ? 0 : this.arousal * Math.exp(-dt / this.settings.arousalTau)
    this.tension = this.settings.tensionTau === 0 ? 0 : this.tension * Math.exp(-dt / this.settings.tensionTau)
  }
}
