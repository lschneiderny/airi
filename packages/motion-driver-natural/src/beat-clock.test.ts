import type { BeatClockState, BeatOnset } from './beat-clock'

import { describe, expect, it } from 'vitest'

import { advanceBeatClock, BEAT_TIMEOUT_SECONDS, beatAt, initialBeatClock } from './beat-clock'
import { createRandomStream } from './random'

interface BeatScript {
  /** Tempo segments in order; each lasts `beats` beats. */
  tempo: { bpm: number, beats: number }[]
  seed: number
  /** Uniform arrival jitter, ± seconds, from the trip to Natural. */
  jitterSeconds?: number
  /** Share of beats the detector misses. */
  dropShare?: number
  /** Share of beats followed by an extra off-beat onset. */
  extraShare?: number
}

/**
 * A detector's output for a scripted song: the true beat times, and the onsets as they reach Natural. Detection
 * happens on the audio clock, so intervals are exact differences of detected times; only the arrival carries jitter.
 */
function scriptBeats(script: BeatScript) {
  const random = createRandomStream(script.seed)
  const jitter = script.jitterSeconds ?? 0
  const beats: number[] = []
  let t = 1
  for (const segment of script.tempo) {
    for (let i = 0; i < segment.beats; i++) {
      beats.push(t)
      t += 60 / segment.bpm
    }
  }
  const detected: number[] = []
  for (let i = 0; i < beats.length; i++) {
    if (random() >= (script.dropShare ?? 0))
      detected.push(beats[i])
    if (i + 1 < beats.length && random() < (script.extraShare ?? 0))
      detected.push(beats[i] + (0.25 + 0.5 * random()) * (beats[i + 1] - beats[i]))
  }
  const onsets: BeatOnset[] = detected.map((time, i) => ({
    at: time + jitter * (2 * random() - 1),
    intervalSeconds: i === 0 ? 5 : time - detected[i - 1],
  }))
  return { beats, onsets }
}

function run(onsets: readonly BeatOnset[], state: BeatClockState = initialBeatClock) {
  const states: BeatClockState[] = []
  for (const onset of onsets) {
    state = advanceBeatClock(state, onset)
    states.push(state)
  }
  return states
}

/** Seconds from `at` to the nearest beat the clock predicts, using the latest state before `at`. */
function phaseErrorAt(onsets: readonly BeatOnset[], states: readonly BeatClockState[], at: number) {
  let state = initialBeatClock
  for (let i = 0; i < onsets.length && onsets[i].at < at; i++)
    state = states[i]
  const position = beatAt(state, at)
  if (position === null)
    return null
  return (position.beats - Math.round(position.beats)) * position.beatSeconds
}

const rms = (values: number[]) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)

describe('beat clock', () => {
  it.each([60, 90, 120, 150, 180])('locks 4 beats after its first in-range interval at %i BPM, not before', (bpm) => {
    const { onsets } = scriptBeats({ tempo: [{ bpm, beats: 12 }], seed: bpm, jitterSeconds: 0.02 })
    const states = run(onsets)
    const locked = states.map((state, i) => beatAt(state, onsets[i].at) !== null)
    // The first onset opens the run and the second brings the first interval it trusts.
    expect(locked.indexOf(true)).toBe(1 + 4)
    expect(locked.slice(5).every(Boolean)).toBe(true)
  })

  it.each([60, 90, 120, 150, 180])('follows a loose detector at %i BPM within 30 ms RMS and 1 % of the period', (bpm) => {
    // At 60 BPM a missed beat leaves a 2 s gap, which ends the music and so the clock (`BEAT_TIMEOUT_SECONDS`).
    const dropShare = bpm > 60 ? 0.1 : 0
    const { beats, onsets } = scriptBeats({ tempo: [{ bpm, beats: 80 }], seed: 7 * bpm, jitterSeconds: 0.02, dropShare, extraShare: 0.1 })
    const states = run(onsets)
    const errors = beats.slice(20).map(at => phaseErrorAt(onsets, states, at))
    expect(errors.every(error => error !== null)).toBe(true)
    expect(rms(errors as number[])).toBeLessThan(0.03)
    for (const state of states.slice(-60))
      expect(Math.abs(state.beatSeconds! - 60 / bpm) / (60 / bpm)).toBeLessThan(0.01)
  })

  it('moves nothing on an off-beat onset, and anchors afresh after four misses in a row', () => {
    const { onsets } = scriptBeats({ tempo: [{ bpm: 120, beats: 10 }], seed: 3 })
    const locked = run(onsets).at(-1)!
    const last = onsets.at(-1)!.at
    const offBeat = advanceBeatClock(locked, { at: last + 0.25, intervalSeconds: 0.25 })
    expect(offBeat.anchor).toBe(locked.anchor)
    expect(offBeat.anchorBeats).toBe(locked.anchorBeats)
    expect(offBeat.hits).toBe(locked.hits)
    expect(beatAt(offBeat, last + 0.3)).not.toBeNull()

    // A song that moves half a beat: four misses, then the clock starts over on the new phase.
    let state = locked
    for (let i = 1; i <= 4; i++)
      state = advanceBeatClock(state, { at: last + 0.25 + 0.5 * i, intervalSeconds: 0.5 })
    expect(state.anchor).toBe(last + 2.25)
    expect(state.anchorBeats).toBe(0)
    expect(beatAt(state, last + 2.3)).toBeNull()
  })

  it('keeps the lock through a step from 120 to 128 BPM and converges within 8 beats', () => {
    const { beats, onsets } = scriptBeats({ tempo: [{ bpm: 120, beats: 20 }, { bpm: 128, beats: 20 }], seed: 11, jitterSeconds: 0.02 })
    const states = run(onsets)
    expect(states.slice(5).every((state, i) => beatAt(state, onsets[i + 5].at) !== null)).toBe(true)
    const errors = beats.slice(20 + 8).map(at => phaseErrorAt(onsets, states, at)!)
    expect(Math.max(...errors.map(Math.abs))).toBeLessThan(0.03)
  })

  // 75 BPM is nearer the old beat at double time, so the clock keeps its octave and predicts every half beat.
  it.each([[90, 1], [100, 1], [75, 2]])('follows a step from 120 to %i BPM within 10 beats', (bpm, perBeat) => {
    const { beats, onsets } = scriptBeats({ tempo: [{ bpm: 120, beats: 20 }, { bpm, beats: 30 }], seed: 13 + bpm, jitterSeconds: 0.02 })
    const states = run(onsets)
    expect(states.at(-1)!.beatSeconds).toBeCloseTo(60 / bpm / perBeat, 3)
    const errors = beats.slice(20 + 10).map(at => phaseErrorAt(onsets, states, at))
    expect(errors.every(error => error !== null && Math.abs(error) < 0.03)).toBe(true)
  })

  it('folds an interval of half or double the beat into its octave', () => {
    const { onsets } = scriptBeats({ tempo: [{ bpm: 120, beats: 10 }], seed: 5 })
    const locked = run(onsets).at(-1)!
    const last = onsets.at(-1)!.at
    expect(advanceBeatClock(locked, { at: last + 0.5, intervalSeconds: 1 }).intervals.at(-1)).toBe(0.5)
    expect(advanceBeatClock(locked, { at: last + 0.5, intervalSeconds: 0.25 }).intervals.at(-1)).toBe(0.5)
    // An interval in range keeps the clock's octave too, so the median never mixes two octaves.
    const fast = run(scriptBeats({ tempo: [{ bpm: 150, beats: 10 }], seed: 5 }).onsets).at(-1)!
    expect(advanceBeatClock(fast, { at: fast.lastOnset! + 0.4, intervalSeconds: 0.85 }).intervals.at(-1)).toBe(0.425)
    // Without a beat length, an interval out of range takes the one fold that brings it in, and none is ignored.
    const opened = advanceBeatClock(initialBeatClock, { at: 1, intervalSeconds: 9 })
    expect(advanceBeatClock(opened, { at: 2.6, intervalSeconds: 1.6 }).intervals).toEqual([0.8])
    expect(advanceBeatClock(opened, { at: 2.6, intervalSeconds: 4 }).intervals).toEqual([])
  })

  it('unlocks without an onset for 1.8 s, and ignores bad and stale onsets', () => {
    const { onsets } = scriptBeats({ tempo: [{ bpm: 120, beats: 10 }], seed: 9 })
    const locked = run(onsets).at(-1)!
    const last = locked.lastOnset!
    expect(beatAt(locked, last + BEAT_TIMEOUT_SECONDS)).not.toBeNull()
    expect(beatAt(locked, last + BEAT_TIMEOUT_SECONDS + 0.01)).toBeNull()
    // The onset after the gap opens a new run; its interval spans the gap.
    expect(advanceBeatClock(locked, { at: last + 2, intervalSeconds: 2 })).toEqual({ ...initialBeatClock, lastOnset: last + 2 })

    expect(advanceBeatClock(locked, { at: Number.NaN, intervalSeconds: 0.5 })).toBe(locked)
    expect(advanceBeatClock(locked, { at: last + 0.5, intervalSeconds: Number.POSITIVE_INFINITY })).toBe(locked)
    expect(advanceBeatClock(locked, { at: last - 0.1, intervalSeconds: 0.5 })).toBe(locked)
    expect(JSON.parse(JSON.stringify(locked))).toEqual(locked)
  })
})
