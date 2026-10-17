import { describe, expect, it } from 'vitest'

import { NaturalPostureLayers } from './posture'
import { createRandomStream, deriveSeed } from './random'
import { NaturalSpeechEmphasis, SpeechOnsetShifts } from './speech-emphasis'

const step = 1 / 120

/** Steps `seconds` of `level(time)` and returns the start times of accepted emphases. */
function emphasesOf(emphasis: NaturalSpeechEmphasis, seconds: number, level: (time: number) => number, acceptance: number) {
  const starts: number[] = []
  for (let i = 1; i <= seconds / step; i++) {
    const before = emphasis.emphasisCount
    emphasis.step(step, level(i * step), acceptance)
    if (emphasis.emphasisCount !== before)
      starts.push(i * step)
  }
  return starts
}

/** Speech phrases of 4 Hz syllables (2.5 s) separated by 1.1 s pauses. */
function phraseLevel(time: number) {
  const phase = time % 3.6
  return phase < 2.5 ? 0.8 * Math.sin(Math.PI * (phase % 0.25) / 0.25) ** 2 : 0
}

/** Steps posture and emphasis like the facade for `seconds`; returns onset and shift-start times. */
function simulateOnsetShifts(seed: number, seconds: number, locked: boolean) {
  const stream = (layer: number) => createRandomStream(deriveSeed(seed, layer))
  const posture = new NaturalPostureLayers([0, -0.1, 0], { drift: stream(0), continuous: stream(1), gain: stream(2), shift: stream(3) })
  const emphasis = new NaturalSpeechEmphasis(stream(10))
  const onsetShifts = new SpeechOnsetShifts()
  const onsets: number[] = []
  const shifts: number[] = []
  for (let i = 0; i < seconds / step; i++) {
    const stepStart = i * step
    const onsetsBefore = emphasis.onsetCount
    emphasis.step(step, phraseLevel(stepStart + step), 0.25)
    if (emphasis.onsetCount !== onsetsBefore)
      onsets.push(stepStart + step)
    if (locked)
      onsetShifts.update(posture, emphasis, true)
    const shiftsBefore = posture.shiftCount
    posture.step(step)
    if (posture.shiftCount !== shiftsBefore)
      shifts.push(stepStart)
  }
  return { onsets, shifts }
}

describe('natural speech emphasis', () => {
  it('starts some due posture shifts at speech onsets without adding shifts', () => {
    const locked = simulateOnsetShifts(3, 10 * 60, true)
    const free = simulateOnsetShifts(3, 10 * 60, false)
    const nearOnset = (shifts: number[]) => locked.onsets.filter(onset => shifts.some(shift => Math.abs(shift - onset) <= 0.05)).length
    expect(nearOnset(locked.shifts)).toBeGreaterThan(2 * nearOnset(free.shifts))
    expect(nearOnset(locked.shifts)).toBeLessThan(locked.onsets.length)
    // Shifts only move earlier, and the advanced time returns to the next hold.
    expect(Math.abs(locked.shifts.length - free.shifts.length)).toBeLessThanOrEqual(2)
  })

  it('ignores onsets while not speaking', () => {
    const posture = new NaturalPostureLayers([0, 0, 0], { drift: createRandomStream(1), continuous: createRandomStream(2), gain: createRandomStream(3), shift: createRandomStream(4) })
    const emphasis = new NaturalSpeechEmphasis(createRandomStream(5))
    const onsetShifts = new SpeechOnsetShifts()
    for (let i = 0; i < 30 / step; i++) {
      emphasis.step(step, phraseLevel(i * step), 0.25)
      const before = posture.secondsUntilShift
      onsetShifts.update(posture, emphasis, false)
      expect(posture.secondsUntilShift).toBe(before)
      posture.step(step)
    }
  })

  it('stays still in silence', () => {
    const emphasis = new NaturalSpeechEmphasis(createRandomStream(1))
    expect(emphasesOf(emphasis, 30, () => 0, 1)).toEqual([])
  })

  it('keeps emphases at least 1.2 s apart on a dense onset train', () => {
    const emphasis = new NaturalSpeechEmphasis(createRandomStream(2))
    // Every onset is accepted, so only the refractory period limits the rate.
    const starts = emphasesOf(emphasis, 10, time => (time % 0.3 < 0.12 ? 0.9 : 0), 1)
    expect(starts.length).toBeGreaterThan(3)
    const gaps = starts.slice(1).map((start, i) => start - starts[i])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1.2)
  })

  it('nods with 0.02-0.05 head pulses, mostly pitch down', () => {
    let nods = 0
    let tilts = 0
    for (let seed = 1; seed <= 200; seed++) {
      const emphasis = new NaturalSpeechEmphasis(createRandomStream(seed))
      let peak = [0, 0, 0]
      for (let i = 1; i <= 2 / step; i++) {
        const offset = emphasis.step(step, i * step > 0.2 ? 0.8 : 0, 1)
        peak = peak.map((value, axis) => Math.abs(offset[axis]) > Math.abs(value) ? offset[axis] : value)
      }
      expect(emphasis.emphasisCount).toBe(1)
      const size = Math.hypot(...peak)
      expect(size).toBeGreaterThanOrEqual(0.02 - 1e-3)
      expect(size).toBeLessThanOrEqual(0.05 + 1e-9)
      if (peak[1] < 0)
        nods++
      else
        tilts++
    }
    expect(nods / (nods + tilts)).toBeGreaterThan(0.7)
    expect(nods / (nods + tilts)).toBeLessThan(0.9)
  })
})
