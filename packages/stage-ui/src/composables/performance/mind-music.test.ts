import type { MindStimulus } from '@proj-airi/character-mind'
import type { AppCategory } from '@proj-airi/stage-shared/situation'

import { CharacterMind } from '@proj-airi/character-mind'
import { MUSIC_RELEASE_MS, MUSIC_SETTLE_MS } from '@proj-airi/stage-shared/music'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MindMusic } from './mind-music'

const T0 = 1_700_000_000_000

/** A mind on the fake clock, a fake beat source, and the music stimuli the mind received with their times. */
function setup() {
  const mind = new CharacterMind({ seed: 1 })
  const received: Array<{ playing: boolean, atMs: number }> = []
  mind.onStep(({ stimuli, atMs }) => {
    for (const stimulus of stimuli as MindStimulus[]) {
      if (stimulus.kind === 'music')
        received.push({ playing: stimulus.playing, atMs: atMs - T0 })
    }
  })
  const beats = { onBeat: undefined as ((beat: { intervalSeconds: number }) => void) | undefined, unlisten: vi.fn() }
  const listen = vi.fn((onBeat: (beat: { intervalSeconds: number }) => void) => {
    beats.onBeat = onBeat
    return beats.unlisten
  })
  let category: AppCategory | null = null
  const heard: number[] = []
  const music = new MindMusic(mind, { listen, category: () => category, onBeat: beat => heard.push(beat.intervalSeconds) })
  return {
    mind,
    music,
    received,
    heard,
    listen,
    beats,
    setCategory(next: AppCategory | null) {
      category = next
    },
    /** Beats every 500 ms from now for `ms`, the last one at the end. */
    beatFor(ms: number) {
      for (let elapsed = 0; elapsed <= ms; elapsed += 500) {
        if (elapsed > 0)
          vi.advanceTimersByTime(500)
        beats.onBeat!({ intervalSeconds: 0.5 })
      }
    },
  }
}

describe('mind music', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hands each beat\'s interval on while started, and none while stopped', () => {
    const { music, heard, beats } = setup()
    music.start()
    beats.onBeat!({ intervalSeconds: 0.5 })
    beats.onBeat!({ intervalSeconds: 0.52 })
    expect(heard).toEqual([0.5, 0.52])
    music.stop()
    expect(beats.unlisten).toHaveBeenCalledTimes(1)
    expect(heard).toEqual([0.5, 0.52])
  })

  it('turns beats into one start at the settle point and one stop at the release, from its deadline timer', () => {
    const { music, received, beatFor } = setup()
    music.start()
    beatFor(MUSIC_SETTLE_MS - 500)
    expect(received).toEqual([])
    // The settle point falls between beats, so the deadline timer reaches it.
    vi.advanceTimersByTime(499)
    expect(received).toEqual([])
    vi.advanceTimersByTime(1)
    expect(received).toEqual([{ playing: true, atMs: MUSIC_SETTLE_MS }])
    beatFor(2000)
    const lastBeat = MUSIC_SETTLE_MS + 2000
    vi.advanceTimersByTime(MUSIC_RELEASE_MS - 1)
    expect(received).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(received).toEqual([{ playing: true, atMs: MUSIC_SETTLE_MS }, { playing: false, atMs: lastBeat + MUSIC_RELEASE_MS }])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ends the music when a quiet app comes to the front', () => {
    const { music, received, beatFor, setCategory } = setup()
    music.start()
    beatFor(MUSIC_SETTLE_MS)
    setCategory('call')
    music.observeCategory()
    expect(received.map(edge => edge.playing)).toEqual([true, false])
  })

  it('stops listening at stop and tells the mind the music stopped', () => {
    const { mind, music, received, listen, beats, beatFor } = setup()
    music.start()
    music.start()
    expect(listen).toHaveBeenCalledTimes(1)
    beatFor(MUSIC_SETTLE_MS)
    expect(mind.state.music.playing).toBe(true)
    music.stop()
    expect(beats.unlisten).toHaveBeenCalledTimes(1)
    expect(received.map(edge => edge.playing)).toEqual([true, false])
    expect(mind.state.music.playing).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    // A stop without music says nothing.
    music.stop()
    expect(received).toHaveLength(2)
  })

  it('re-sends the music to a mind that was reset, and nothing when none plays', () => {
    const { mind, music, received, beatFor } = setup()
    music.replay()
    expect(received).toEqual([])
    music.start()
    beatFor(MUSIC_SETTLE_MS)
    mind.reset({ pacing: null })
    expect(mind.state.music.playing).toBe(false)
    music.replay()
    expect(mind.state.music.playing).toBe(true)
    expect(received.map(edge => edge.playing)).toEqual([true, true])
  })
})
