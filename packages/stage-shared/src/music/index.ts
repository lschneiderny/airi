import type { AppCategory } from '../situation/types'

/** Beats must run this long before they count as music, so a notification sound or a short clip never starts her. */
export const MUSIC_SETTLE_MS = 8_000
/** A gap between beats this long ends the run. It matches the default `releaseDelayMs` of upstream's beat sync. */
export const MUSIC_RELEASE_MS = 1_800
/** Apps whose sound is not something to sway to: a game's effects, and other people's voices. */
export const QUIET_CATEGORIES: ReadonlySet<AppCategory> = new Set<AppCategory>(['game', 'call', 'chat'])

/** The current run of beats. Plain JSON. */
export interface MusicMemory {
  /** The first beat of the current run of beats, in epoch milliseconds of the caller's clock; null while none runs. */
  readonly sinceMs: number | null
  /** The latest beat of the run; null while none runs. */
  readonly lastBeatAtMs: number | null
  /** Whether the run counts as music. */
  readonly playing: boolean
}

/** One thing the host saw: a beat, the deadline timer, or a change of the foreground app. */
export interface MusicObservation {
  atMs: number
  beat: boolean
  /** The foreground app's category, or null on a host that cannot tell. */
  category: AppCategory | null
}

export type MusicEdge = 'started' | 'stopped'

export const initialMusicMemory: MusicMemory = Object.freeze({ sinceMs: null, lastBeatAtMs: null, playing: false })

/**
 * Applies one observation. `edge` is the change of `playing` it caused, or null.
 *
 * A run of beats is music once `atMs` reaches `sinceMs + MUSIC_SETTLE_MS`. The run ends when `atMs` reaches
 * `lastBeatAtMs + MUSIC_RELEASE_MS`, when a quiet app is in front, or when the clock steps back before the run's last
 * beat; a beat after that starts a new run. Beats are ignored while a quiet app stays in front, and a non-finite time
 * changes nothing. Pure: time comes from the observation.
 */
export function advanceMusic(memory: MusicMemory, observation: MusicObservation): { memory: MusicMemory, edge: MusicEdge | null } {
  const { atMs } = observation
  if (!Number.isFinite(atMs))
    return { memory, edge: null }

  let run = memory
  const quiet = observation.category !== null && QUIET_CATEGORIES.has(observation.category)
  if (quiet || (run.lastBeatAtMs !== null && (atMs < run.lastBeatAtMs || atMs >= run.lastBeatAtMs + MUSIC_RELEASE_MS)))
    run = initialMusicMemory

  if (observation.beat && !quiet)
    run = { sinceMs: run.sinceMs ?? atMs, lastBeatAtMs: atMs, playing: run.playing }

  const playing = run.sinceMs !== null && atMs >= run.sinceMs + MUSIC_SETTLE_MS
  if (playing !== run.playing)
    run = { ...run, playing }

  const edge = playing === memory.playing ? null : playing ? 'started' : 'stopped'
  return { memory: run, edge }
}

/** The next time at which `playing` can change without a new beat: the settle end or the release. Null while no run. */
export function nextMusicDeadline(memory: MusicMemory): number | null {
  if (memory.sinceMs === null || memory.lastBeatAtMs === null)
    return null
  const release = memory.lastBeatAtMs + MUSIC_RELEASE_MS
  return memory.playing ? release : Math.min(memory.sinceMs + MUSIC_SETTLE_MS, release)
}
