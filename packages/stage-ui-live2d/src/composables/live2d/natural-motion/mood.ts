import type { ExpressionPerformanceSettings, ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

const coefficients: Record<ReactionEpisode['emotion'], readonly [number, number, number]> = {
  happy: [0.7, 0.5, -0.2],
  sad: [-0.6, -0.5, 0.1],
  angry: [-0.5, 0.6, 0.8],
  think: [0, -0.15, 0.15],
  surprised: [0.1, 0.8, 0.35],
  awkward: [-0.25, 0.15, 0.6],
  question: [0, 0.1, 0.1],
  curious: [0.2, 0.3, 0],
  neutral: [0, 0, 0],
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** Active-time afterglow. Episode doses survive decay so escalations add only the missing dose. */
export class NaturalMood {
  valence = 0
  arousal = 0
  tension = 0
  private settings = defaultExpressionPerformanceSettings.moodDynamics
  private readonly episodes = new Map<string, { emotion: ReactionEpisode['emotion'], dose: number }>()

  setPerformanceSettings(settings: ExpressionPerformanceSettings['moodDynamics']) {
    this.settings = { ...settings }
  }

  get active() {
    return this.valence !== 0 || this.arousal !== 0 || this.tension !== 0
  }

  /** Ignores malformed doses and stale escalations without changing accumulated state. */
  add(episode: ReactionEpisode) {
    if (!Number.isFinite(episode.intensity) || episode.intensity <= 0)
      return
    const previous = this.episodes.get(episode.id)
    if (episode.escalation && (!previous || previous.emotion !== episode.emotion))
      return
    if (!episode.escalation && previous)
      return
    // acceptReaction can escalate only its current episode. Retire dose bookkeeping,
    // not accumulated mood, when a new episode replaces it.
    if (!episode.escalation)
      this.episodes.clear()
    const gain = this.settings[`${episode.band}Gain`]
    const dose = gain * clamp(episode.intensity, 0, 1)
    const delta = Math.max(0, dose - (episode.escalation ? previous!.dose : 0))
    const [valence, arousal, tension] = coefficients[episode.emotion]
    this.valence = clamp(this.valence + delta * valence, -1, 1)
    this.arousal = clamp(this.arousal + delta * arousal, -1, 1)
    this.tension = clamp(this.tension + delta * tension, 0, 1)
    this.episodes.set(episode.id, { emotion: episode.emotion, dose: Math.max(dose, episode.escalation ? previous!.dose : 0) })
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
