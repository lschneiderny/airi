import type { MusicMemory, MusicObservation } from '.'
import type { AppCategory } from '../situation/types'

import { describe, expect, it } from 'vitest'

import { advanceMusic, initialMusicMemory, MUSIC_RELEASE_MS, MUSIC_SETTLE_MS, nextMusicDeadline } from '.'

const T0 = 1_700_000_000_000.25

function beat(atMs: number, category: AppCategory | null = null): MusicObservation {
  return { atMs, beat: true, category }
}

function tick(atMs: number, category: AppCategory | null = null): MusicObservation {
  return { atMs, beat: false, category }
}

/** Applies observations in order and returns the final memory with every edge and the time it happened. */
function play(observations: MusicObservation[], memory: MusicMemory = initialMusicMemory) {
  const edges: Array<{ atMs: number, edge: string }> = []
  for (const observation of observations) {
    const result = advanceMusic(memory, observation)
    memory = result.memory
    if (result.edge)
      edges.push({ atMs: observation.atMs, edge: result.edge })
  }
  return { memory, edges }
}

/** Beats every `stepMs` from `fromMs` up to and including `toMs`. */
function beats(fromMs: number, toMs: number, stepMs = 500): MusicObservation[] {
  const result: MusicObservation[] = []
  for (let at = fromMs; at <= toMs; at += stepMs)
    result.push(beat(at))
  return result
}

describe('advanceMusic', () => {
  it('starts music at the beat that completes the settle time', () => {
    const { memory, edges } = play(beats(T0, T0 + MUSIC_SETTLE_MS))

    expect(edges).toEqual([{ atMs: T0 + MUSIC_SETTLE_MS, edge: 'started' }])
    expect(memory.playing).toBe(true)
  })

  it('starts music at the settle deadline when beats continue', () => {
    const { memory } = play(beats(T0, T0 + 7_700, 700))
    const deadline = nextMusicDeadline(memory)

    expect(deadline).toBe(T0 + MUSIC_SETTLE_MS)
    expect(advanceMusic(memory, tick(deadline!)).edge).toBe('started')
  })

  it('ends the run at the release deadline, and a later beat starts over', () => {
    const playing = play(beats(T0, T0 + 9_000)).memory
    const deadline = nextMusicDeadline(playing)!

    expect(deadline).toBe(playing.lastBeatAtMs! + MUSIC_RELEASE_MS)
    expect(advanceMusic(playing, tick(deadline - 1)).edge).toBeNull()

    const released = advanceMusic(playing, tick(deadline))
    expect(released.edge).toBe('stopped')
    expect(released.memory).toEqual(initialMusicMemory)

    const again = advanceMusic(released.memory, beat(deadline + 5_000))
    expect(again.edge).toBeNull()
    expect(again.memory.sinceMs).toBe(deadline + 5_000)
  })

  it('produces the edge exactly at the deadline, whatever the rounding of the sum', () => {
    // A fractional start makes the deadline a rounded sum; the rule must compare the same sum.
    const start = 0.1 + 0.2
    const running = play(beats(start, start + 7_000)).memory
    const settle = nextMusicDeadline(running)!

    expect(settle).toBe(start + MUSIC_SETTLE_MS)
    expect(advanceMusic(running, tick(settle)).edge).toBe('started')

    const playing = advanceMusic(running, tick(settle)).memory
    const release = nextMusicDeadline(playing)!
    expect(advanceMusic(playing, tick(release)).edge).toBe('stopped')
  })

  it('lets a gap end a run before it settles, without an edge', () => {
    const { memory, edges } = play([...beats(T0, T0 + 4_000), ...beats(T0 + 4_000 + MUSIC_RELEASE_MS, T0 + 14_000, 200)])

    expect(edges).toEqual([{ atMs: T0 + 4_000 + MUSIC_RELEASE_MS + MUSIC_SETTLE_MS, edge: 'started' }])
    expect(memory.sinceMs).toBe(T0 + 4_000 + MUSIC_RELEASE_MS)
  })

  it('ends the run in a quiet app and ignores beats while it stays in front', () => {
    const playing = play(beats(T0, T0 + 9_000)).memory

    const quiet = advanceMusic(playing, beat(T0 + 9_200, 'game'))
    expect(quiet.edge).toBe('stopped')
    expect(quiet.memory).toEqual(initialMusicMemory)

    const { memory, edges } = play(beats(T0 + 9_400, T0 + 30_000).map(({ atMs }) => beat(atMs, 'call')), quiet.memory)
    expect(edges).toEqual([])
    expect(memory).toEqual(initialMusicMemory)
  })

  it('counts an unknown category as not quiet', () => {
    expect(play(beats(T0, T0 + MUSIC_SETTLE_MS).map(({ atMs }) => beat(atMs, null))).memory.playing).toBe(true)
  })

  it('never starts music on a clock that steps back', () => {
    const observations = [...beats(T0, T0 + 5_000), ...beats(T0 - 3_000, T0 + 1_000)]
    const { memory, edges } = play(observations)

    expect(edges).toEqual([])
    expect(memory.sinceMs).toBe(T0 - 3_000)
  })

  it('ignores a non-finite time', () => {
    const running = play(beats(T0, T0 + 1_000)).memory

    expect(advanceMusic(running, beat(Number.NaN))).toEqual({ memory: running, edge: null })
  })
})

describe('nextMusicDeadline', () => {
  it('is null with no run', () => {
    expect(nextMusicDeadline(initialMusicMemory)).toBeNull()
  })

  it('is the settle end while the run has not settled, and the release while it plays', () => {
    const running = play([beat(T0)]).memory
    expect(nextMusicDeadline(running)).toBe(T0 + MUSIC_RELEASE_MS)

    const late = play(beats(T0, T0 + 7_000)).memory
    expect(nextMusicDeadline(late)).toBe(T0 + MUSIC_SETTLE_MS)

    const playing = play(beats(T0, T0 + 10_000)).memory
    expect(nextMusicDeadline(playing)).toBe(T0 + 10_000 + MUSIC_RELEASE_MS)
  })
})
