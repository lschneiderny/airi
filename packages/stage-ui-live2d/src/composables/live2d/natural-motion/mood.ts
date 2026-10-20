import type { ExpressionPerformanceSettings, ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

import { naturalEmotions } from './emotions'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/**
 * An episode as the Natural performer consumes it. `moodGain` is the mood dose gain for the
 * episode's band under the character profile that produced it; the stage resolves it when it
 * decides the episode, so a later decision under another profile cannot change this dose.
 * Without it, the performer's own band gain applies.
 */
export interface NaturalEpisode extends ReactionEpisode {
  moodGain?: number
}

/** Active-time afterglow. Episode doses survive decay so escalations add only the missing dose. */
export class NaturalMood {
  valence = 0
  arousal = 0
  tension = 0
  private settings = defaultExpressionPerformanceSettings.moodDynamics
  private readonly episodes = new Map<string, { emotion: ReactionEpisode['emotion'], dose: number }>()

  constructor(private readonly emotions = naturalEmotions) {}

  setPerformanceSettings(settings: ExpressionPerformanceSettings['moodDynamics']) {
    this.settings = { ...settings }
  }

  get active() {
    return this.valence !== 0 || this.arousal !== 0 || this.tension !== 0
  }

  /** Ignores malformed doses and stale escalations without changing accumulated state. */
  add(episode: NaturalEpisode) {
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
    const gain = episode.moodGain ?? this.settings[`${episode.band}Gain`]
    const dose = gain * clamp(episode.intensity, 0, 1)
    const delta = Math.max(0, dose - (episode.escalation ? previous!.dose : 0))
    const [valence, arousal, tension] = this.emotions[episode.emotion].mood
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
