import type { NaturalFaceOutput } from './face'

import { describe, expect, it } from 'vitest'

import { NaturalFaceLayer } from './face'
import { createRandomStream } from './random'

const dt = 1 / 120

function standardDeviation(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
}

function record(face: NaturalFaceLayer, seconds: number, beforeStep?: (time: number) => void) {
  const frames: NaturalFaceOutput[] = []
  for (let i = 0; i < seconds / dt; i++) {
    beforeStep?.(i * dt)
    frames.push(face.step(dt))
  }
  return frames
}

describe('natural face', () => {
  it('never opens the mouth silently while speech is active or recent', () => {
    const face = new NaturalFaceLayer(createRandomStream(1))
    // Speech alternates every 20 s, so openings drawn in speech and silence both occur.
    const speaking: boolean[] = []
    const frames = record(face, 30 * 60, (time) => {
      face.speechActiveOrRecent = Math.floor(time / 20) % 2 === 1
      speaking.push(face.speechActiveOrRecent)
    })
    const duringSpeech = frames.filter((_, i) => speaking[i]).map(frame => frame.silentMouthOpen)
    const duringSilence = frames.filter((_, i) => !speaking[i]).map(frame => frame.silentMouthOpen)
    const maximum = (values: number[]) => values.reduce((a, b) => Math.max(a, b))
    expect(maximum(duringSpeech)).toBe(0)
    expect(maximum(duringSilence)).toBeGreaterThan(0)
    expect(maximum(duringSilence)).toBeLessThanOrEqual(0.06)
  })

  it('opens the mouth about once per 40 s of silence for 0.6-1.4 s', () => {
    const frames = record(new NaturalFaceLayer(createRandomStream(2)), 30 * 60)
    const runs: number[] = []
    let length = 0
    for (const frame of frames) {
      if (frame.silentMouthOpen > 0) {
        length++
      }
      else if (length > 0) {
        runs.push(length * dt)
        length = 0
      }
    }
    // 45 expected openings in 30 min.
    expect(runs.length).toBeGreaterThan(30)
    expect(runs.length).toBeLessThan(62)
    // An opening that starts inside another one replaces it, so a few runs are merged or cut.
    const typical = runs.filter(run => run >= 0.6 - 2 * dt && run <= 1.4 + 2 * dt).length
    expect(typical / runs.length).toBeGreaterThan(0.9)
  })

  it('moves brows and mouth form with recording-scale spread and slight L/R asymmetry', () => {
    const frames = record(new NaturalFaceLayer(createRandomStream(3)), 30 * 60)
    expect(standardDeviation(frames.map(frame => frame.browLY))).toBeGreaterThan(0.035)
    expect(standardDeviation(frames.map(frame => frame.browLY))).toBeLessThan(0.052)
    // Two independent per-side terms of SD 0.005 give a difference SD of about 0.007.
    const asymmetry = standardDeviation(frames.map(frame => frame.browLY - frame.browRY))
    expect(asymmetry).toBeGreaterThan(0.005)
    expect(asymmetry).toBeLessThan(0.0095)
    expect(standardDeviation(frames.map(frame => frame.mouthForm))).toBeGreaterThan(0.032)
    expect(standardDeviation(frames.map(frame => frame.mouthForm))).toBeLessThan(0.048)
    const lids = frames.map(frame => frame.eyeOpenMultiplier)
    expect(lids.reduce((a, b) => Math.max(a, b))).toBeLessThanOrEqual(1)
    expect(lids.reduce((a, b) => Math.min(a, b))).toBeGreaterThan(0.8)
  })

  it('narrows the lids only on gaze shifts above 0.15 normalized', () => {
    const reference = record(new NaturalFaceLayer(createRandomStream(4)), 5 * 60)
    const small = new NaturalFaceLayer(createRandomStream(4))
    expect(record(small, 5 * 60, () => small.onGazeShift(0.15))).toEqual(reference)
    const large = new NaturalFaceLayer(createRandomStream(4))
    const shifted = record(large, 5 * 60, (time) => {
      if (Math.round(time / dt) % 240 === 0)
        large.onGazeShift(0.3)
    })
    expect(shifted).not.toEqual(reference)
  })
})
