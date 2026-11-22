import type { EmotionBehaviorSettings, MoodDose, ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import { defaultEmotionBehaviorSettings } from '@proj-airi/stage-shared/expression-performance'

type MoodDynamics = EmotionBehaviorSettings['moodDynamics']

/** Her fast mood: valence and arousal in [-1, 1], tension in [0, 1]. */
export interface MoodLevel {
  valence: number
  arousal: number
  tension: number
}

/**
 * The character's fast mood, once per character. Fast state; plain JSON. The level is decayed on the mind's clock only
 * to answer the next dose and to seed a new performer: no frame samples it. The performer decays its own copy on its
 * active seconds from the doses and the seed.
 */
export interface MindMoodState extends MoodLevel {
  /** When the level was last decayed or dosed, in epoch milliseconds of the mind's clock; null before the first dose. */
  atMs: number | null
  /** The decay time constants of the last dose's settings, in seconds; the seed decays with them. */
  taus: { valence: number, arousal: number, tension: number }
  /** The dose of the current emotion episode, so an escalation adds only the missing dose; null before the first. */
  episode: { id: string, emotion: ReactionEpisode['emotion'], dose: number } | null
}

export const initialMindMoodState: MindMoodState = {
  valence: 0,
  arousal: 0,
  tension: 0,
  atMs: null,
  taus: {
    valence: defaultEmotionBehaviorSettings.moodDynamics.valenceTau,
    arousal: defaultEmotionBehaviorSettings.moodDynamics.arousalTau,
    tension: defaultEmotionBehaviorSettings.moodDynamics.tensionTau,
  },
  episode: null,
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function decayed(value: number, tau: number, seconds: number) {
  return tau === 0 ? 0 : value * Math.exp(-seconds / tau)
}

/** The level decayed to `atMs` with the stored time constants, as `NaturalMood.step` decays it. */
export function moodLevelAt(mood: MindMoodState, atMs: number): MoodLevel {
  const seconds = mood.atMs === null ? 0 : (atMs - mood.atMs) / 1000
  if (!(seconds > 0))
    return { valence: mood.valence, arousal: mood.arousal, tension: mood.tension }
  return {
    valence: decayed(mood.valence, mood.taus.valence, seconds),
    arousal: decayed(mood.arousal, mood.taus.arousal, seconds),
    tension: decayed(mood.tension, mood.taus.tension, seconds),
  }
}

/** Decays the level to `atMs` under `dynamics`, then adds `delta` with the performer's clamps. */
function dosed(mood: MindMoodState, delta: MoodLevel, dynamics: MoodDynamics, atMs: number): MindMoodState {
  const level = moodLevelAt(mood, atMs)
  return {
    ...mood,
    valence: clamp(level.valence + delta.valence, -1, 1),
    arousal: clamp(level.arousal + delta.arousal, -1, 1),
    tension: clamp(level.tension + delta.tension, 0, 1),
    atMs,
    taus: { valence: dynamics.valenceTau, arousal: dynamics.arousalTau, tension: dynamics.tensionTau },
  }
}

/**
 * The mood dose of a new or escalated emotion episode and the mood after it. The arithmetic is the one Natural applied
 * per episode before the mind kept the mood: the dose is the band gain times the clamped intensity, an escalation adds
 * only what exceeds the episode's earlier dose, and a new episode replaces the dose bookkeeping, never the level. A
 * moodless episode (a touch already dosed its turn) doses at gain 0 but still records its dose. `dose` is null when
 * nothing changes; its id names the episode and the time, so a performer that outlives a mind reset still applies it.
 */
export function moodEpisodeDose(mood: MindMoodState, episode: ReactionEpisode, settings: Pick<EmotionBehaviorSettings, 'moodDynamics'>, moodless: boolean, atMs: number): { mood: MindMoodState, dose: MoodDose | null } {
  if (!Number.isFinite(episode.intensity) || episode.intensity <= 0)
    return { mood, dose: null }
  const previous = mood.episode?.id === episode.id ? mood.episode : null
  if (episode.escalation && (!previous || previous.emotion !== episode.emotion))
    return { mood, dose: null }
  if (!episode.escalation && previous)
    return { mood, dose: null }

  const gain = moodless ? 0 : settings.moodDynamics[`${episode.band}Gain`]
  const dose = gain * clamp(episode.intensity, 0, 1)
  const delta = Math.max(0, dose - (previous?.dose ?? 0))
  const [valence, arousal, tension] = naturalEmotions[episode.emotion].mood
  const vector = { valence: delta * valence, arousal: delta * arousal, tension: delta * tension }
  const bookkeeping = { id: episode.id, emotion: episode.emotion, dose: Math.max(dose, previous?.dose ?? 0) }
  if (vector.valence === 0 && vector.arousal === 0 && vector.tension === 0)
    return { mood: { ...mood, episode: bookkeeping }, dose: null }

  return {
    mood: { ...dosed(mood, vector, settings.moodDynamics, atMs), episode: bookkeeping },
    dose: { id: `${episode.id}@${atMs}`, ...vector },
  }
}

/** A touch dose the mind decided, added to her level as the performer adds it. */
export function moodTouchDose(mood: MindMoodState, dose: MoodDose, settings: Pick<EmotionBehaviorSettings, 'moodDynamics'>, atMs: number): MindMoodState {
  if (![dose.valence, dose.arousal, dose.tension].every(Number.isFinite))
    return mood
  return dosed(mood, dose, settings.moodDynamics, atMs)
}
