import type { ExpressionPerformanceSettings } from './settings'
import type { Band, PerformanceEmotion, ReactionEpisode } from './types'

/** Checkpointable history for the uninterrupted current emotion, with seconds supplied by callers. */
export interface ReactionState {
  random: number
  counter: number
  lastAt: number | null
  starts: number[]
  current: { episode: ReactionEpisode, startedAt: number, h: number, u: number } | null
}

/** Seeds are normalized to uint32; no global random source is used. */
export function createReactionState(seed: number): ReactionState {
  return { random: seed >>> 0, counter: 0, lastAt: null, starts: [], current: null }
}

/** Zero and non-finite doses have no band. Thresholds come from validated settings. */
export function bandOf(intensity: number, settings: ExpressionPerformanceSettings): Band | null {
  if (!Number.isFinite(intensity) || intensity <= 0)
    return null
  if (intensity >= settings.intensity.strongFrom)
    return 'strong'
  return intensity >= settings.intensity.clearFrom ? 'clear' : 'slight'
}

function jittered(dose: number, u: number, settings: ExpressionPerformanceSettings) {
  const band = bandOf(dose, settings)
  const { clearFrom, strongFrom, jitter } = settings.intensity
  // The open endpoints stay positive and cannot cross into the next band.
  const lower = band === 'strong' ? strongFrom : band === 'clear' ? clearFrom : 1e-9
  const upper = band === 'strong' ? 1 : (band === 'clear' ? strongFrom : clearFrom) - 1e-9
  return { band: band ?? 'slight', intensity: Math.max(lower, Math.min(upper, dose + jitter * (2 * u - 1))) }
}

/**
 * Returns a new state without modifying a checkpoint. Unknown emotions and non-finite or
 * backwards timestamps are ignored. Finite doses clamp to [0,1]; non-finite doses act
 * as zero, clearing history. Neutral also clears history, but preserves ids and PRNG.
 */
export function acceptReaction(state: ReactionState, emotion: PerformanceEmotion, nominal: number, at: number, settings: ExpressionPerformanceSettings): { episode: ReactionEpisode | null, state: ReactionState } {
  if (!['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral'].includes(emotion)
    || !Number.isFinite(at) || (state.lastAt !== null && at < state.lastAt)) {
    return { episode: null, state }
  }

  nominal = Number.isFinite(nominal) ? Math.max(0, Math.min(1, nominal)) : 0
  const next = { ...state, lastAt: at }
  if (emotion === 'neutral' || nominal === 0)
    return { episode: null, state: { ...next, current: null, starts: [] } }

  const current = state.current
  if (current?.episode.emotion === emotion && at - current.startedAt < settings.intensity.escalationWindow) {
    if (nominal <= current.episode.nominal)
      return { episode: null, state: next }
    const dose = jittered(nominal * current.h, current.u, settings)
    const episode = { ...current.episode, ...dose, nominal, escalation: true, intensity: Math.max(current.episode.intensity, dose.intensity) }
    return { episode, state: { ...next, current: { ...current, episode } } }
  }

  const starts = current?.episode.emotion === emotion
    ? state.starts.filter(start => at - start < settings.intensity.habituationWindow)
    : []
  const h = Math.max(settings.intensity.habituationFloor, settings.intensity.habituationBase ** starts.length)
  // Mulberry32 keeps its complete stream position in one uint32 for JSON checkpoints.
  const random = (state.random + 0x6D2B79F5) >>> 0
  let bits = Math.imul(random ^ (random >>> 15), random | 1)
  bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61)
  const u = ((bits ^ (bits >>> 14)) >>> 0) / 4294967296
  const episode = { id: `${emotion}-${state.counter + 1}`, emotion, nominal, ...jittered(nominal * h, u, settings), escalation: false }
  return { episode, state: { ...next, random, counter: state.counter + 1, starts: [...starts, at], current: { episode, startedAt: at, h, u } } }
}
