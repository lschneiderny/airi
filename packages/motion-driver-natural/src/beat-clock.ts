import { MUSIC_RELEASE_MS } from '@proj-airi/stage-shared/music'

/**
 * The beats the clock follows, in seconds: 180 to 60 BPM, widened by 5 % so that a song at either end does not
 * straddle the edge with each detected interval and alternate between two octaves.
 */
export const BEAT_MIN_SECONDS = 1 / 3 / 1.05
export const BEAT_MAX_SECONDS = 1.05
/** Accepted intervals whose median is the beat length; a median ignores the loose detector's misses and extras. */
export const BEAT_HISTORY = 8
/** An onset within this share of a beat from a predicted beat is a hit. */
export const BEAT_HIT_TOLERANCE = 0.2
/**
 * The share of a hit's error by which the anchor moves: a first-order phase-locked loop in the manner of an adaptive
 * oscillator (Large and Kolen 1994, "Resonance and the perception of musical meter", Connection Science 6(2-3)).
 */
export const BEAT_PHASE_GAIN = 0.3
/** Hits since the anchor that lock the clock, and misses in a row that re-anchor it on the latest onset. */
export const BEAT_LOCK_ONSETS = 4
/** Seconds without an onset after which the clock unlocks: the release of the music detector, `MUSIC_RELEASE_MS`. */
export const BEAT_TIMEOUT_SECONDS = MUSIC_RELEASE_MS / 1000
/**
 * Seconds by which a beat reaches Natural after its sound: the detector's envelope, the worklet quantum, and the trip
 * to the stage. The clock predicts each beat this much earlier than its onsets show it.
 */
export const BEAT_LEAD_SECONDS = 0

/**
 * Natural's estimate of the beat of the music she hears. Pure and plain JSON. Times are seconds of Natural's active
 * time. The period comes from the detector's intervals, which it measures on the audio clock; the phase comes from the
 * onsets' arrival on Natural's clock, through a loop gain that smooths the trip's jitter.
 */
export interface BeatClockState {
  /** The estimated beat length in seconds; null before the first accepted interval. */
  readonly beatSeconds: number | null
  /** Active time of the latest predicted beat the clock is anchored on; null before it has a beat length. */
  readonly anchor: number | null
  /** The beat count of `anchor` since the clock was last anchored afresh, so the count never steps at a hit. */
  readonly anchorBeats: number
  /** The last accepted intervals in seconds, newest last, at most `BEAT_HISTORY`. */
  readonly intervals: readonly number[]
  /** Hits since the anchor was set, at most `BEAT_LOCK_ONSETS`; the clock is locked at `BEAT_LOCK_ONSETS`. */
  readonly hits: number
  /** Misses since the latest hit; at `BEAT_LOCK_ONSETS` the clock re-anchors on the latest onset. */
  readonly misses: number
  /** Active time of the latest accepted onset; null before one. */
  readonly lastOnset: number | null
}

export const initialBeatClock: BeatClockState = Object.freeze({ beatSeconds: null, anchor: null, anchorBeats: 0, intervals: Object.freeze([]), hits: 0, misses: 0, lastOnset: null })

/** One detected beat: `at` is when it reached Natural, `intervalSeconds` the detector's seconds since its previous beat. */
export interface BeatOnset {
  at: number
  intervalSeconds: number
}

/** The clock's beat at one moment while it is locked. */
export interface BeatPosition {
  /** Beats since the clock was anchored afresh: whole at each predicted beat, continuous between them. */
  beats: number
  beatSeconds: number
}

function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const inRange = (seconds: number) => seconds >= BEAT_MIN_SECONDS && seconds <= BEAT_MAX_SECONDS

/**
 * The interval as a beat length: itself, its half, or its double. With a beat length known, the one of these in range
 * that is nearest to it, so a tempo at the edge of the range does not alternate between two octaves; without one, the
 * interval itself when it is in range, else the one fold that brings it into range. Null when none is in range.
 */
function foldInterval(intervalSeconds: number, beatSeconds: number | null): number | null {
  const candidates = [intervalSeconds, intervalSeconds / 2, intervalSeconds * 2].filter(inRange)
  if (candidates.length === 0)
    return null
  if (beatSeconds === null)
    return candidates[0]
  const distance = (seconds: number) => Math.abs(Math.log(seconds / beatSeconds))
  return candidates.reduce((best, seconds) => distance(seconds) < distance(best) ? seconds : best)
}

function timedOut(state: BeatClockState, at: number) {
  return state.lastOnset === null || at - state.lastOnset > BEAT_TIMEOUT_SECONDS
}

/**
 * Applies one onset. The onset that opens a run (the first, or the first after `BEAT_TIMEOUT_SECONDS` without one)
 * starts the clock over and only records its time: its interval counts from a previous run. Every later interval
 * that folds into range joins the median. An onset within `BEAT_HIT_TOLERANCE` of a predicted beat is a hit and moves
 * the anchor by `BEAT_PHASE_GAIN` of its error; any other onset is a miss and moves nothing, and `BEAT_LOCK_ONSETS`
 * misses in a row anchor the clock afresh on the latest onset. Non-finite values and an onset earlier than the latest
 * one change nothing.
 */
export function advanceBeatClock(state: BeatClockState, onset: BeatOnset): BeatClockState {
  const { at, intervalSeconds } = onset
  if (!Number.isFinite(at) || !Number.isFinite(intervalSeconds) || (state.lastOnset !== null && at < state.lastOnset))
    return state
  if (timedOut(state, at))
    return { ...initialBeatClock, lastOnset: at }

  const folded = foldInterval(intervalSeconds, state.beatSeconds)
  const intervals = folded === null ? state.intervals : [...state.intervals, folded].slice(-BEAT_HISTORY)
  const beatSeconds = intervals.length > 0 ? median(intervals) : null
  if (beatSeconds === null)
    return { ...state, lastOnset: at }
  if (state.anchor === null)
    return { ...state, beatSeconds, intervals, anchor: at, anchorBeats: 0, hits: 0, misses: 0, lastOnset: at }

  const elapsedBeats = Math.round((at - state.anchor) / beatSeconds)
  const predicted = state.anchor + elapsedBeats * beatSeconds
  const error = at - predicted
  if (elapsedBeats >= 1 && Math.abs(error) <= BEAT_HIT_TOLERANCE * beatSeconds) {
    return {
      beatSeconds,
      intervals,
      anchor: predicted + BEAT_PHASE_GAIN * error,
      anchorBeats: state.anchorBeats + elapsedBeats,
      hits: Math.min(BEAT_LOCK_ONSETS, state.hits + 1),
      misses: 0,
      lastOnset: at,
    }
  }
  const misses = state.misses + 1
  if (misses >= BEAT_LOCK_ONSETS)
    return { beatSeconds, intervals, anchor: at, anchorBeats: 0, hits: 0, misses: 0, lastOnset: at }
  return { ...state, beatSeconds, intervals, misses, lastOnset: at }
}

/**
 * The clock's beat at `at` while it is locked, `BEAT_LEAD_SECONDS` ahead of the onsets; null while it is unlocked or
 * timed out. `beats` is whole at each predicted beat.
 */
export function beatAt(state: BeatClockState, at: number): BeatPosition | null {
  const { beatSeconds, anchor } = state
  if (beatSeconds === null || anchor === null || state.hits < BEAT_LOCK_ONSETS || timedOut(state, at))
    return null
  return { beats: state.anchorBeats + (at + BEAT_LEAD_SECONDS - anchor) / beatSeconds, beatSeconds }
}
