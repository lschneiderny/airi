import { PERFORMANCE_EMOTIONS } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { motion3dScenarios } from './scenarios'

describe('motion3d scenario timelines', () => {
  // Default seed-1 counts; gaze count varies with seeded hold/return durations.
  const counts = { 'idle': 1, 'gaze-shift': 18, 'speak': 3, 'emotions': 13, 'walk': 2, 'touch': 10 } as const
  it.each(motion3dScenarios)('replays $id for equal seeds and varies for another seed', (scenario) => {
    const first = scenario.timeline(1, scenario.seconds)
    expect(scenario.timeline(1, scenario.seconds)).toEqual(first)
    expect(scenario.timeline(2, scenario.seconds)).not.toEqual(first)
    const expected = Object.entries(counts).find(([id]) => id === scenario.id)?.[1]
    if (expected === undefined)
      throw new Error(`Missing protocol count for ${scenario.id}`)
    expect(first).toHaveLength(expected)
    expect(first.every(cue => cue.at >= 0 && cue.at < scenario.seconds)).toBe(true)
    expect(first.map(cue => cue.at)).toEqual(first.map(cue => cue.at).sort((a, b) => a - b))
  })

  it('holds all six gaze angles for three to five seconds with two to four seconds forward between them', () => {
    const scenario = motion3dScenarios.find(scenario => scenario.id === 'gaze-shift')
    if (!scenario)
      throw new Error('Missing gaze-shift scenario')
    const timeline = scenario.timeline(1, 60)
    const yaws = timeline.slice(0, 12).filter((_, i) => i % 2 === 0).map((cue) => {
      if (cue.kind !== 'gaze' || !cue.cursor)
        throw new Error('Expected a gaze cursor')
      return Math.round(Math.asin(cue.cursor.x / 3) * 180 / Math.PI)
    })
    expect(yaws.sort((a, b) => a - b)).toEqual([-80, -40, -15, 15, 40, 80])
    timeline.slice(1).forEach((cue, i) => {
      const spacing = cue.at - timeline[i].at
      expect(spacing).toBeGreaterThanOrEqual(i % 2 === 0 ? 3 : 2)
      expect(spacing).toBeLessThanOrEqual(i % 2 === 0 ? 5 : 4)
      if (i % 2 === 0) {
        if (cue.kind !== 'gaze')
          throw new Error('Expected a gaze return')
        expect(cue.cursor).toEqual({ x: 0, y: 0 })
      }
    })
  })

  it('walks thirty leg lengths out and back in separate sixty second legs', () => {
    const scenario = motion3dScenarios.find(scenario => scenario.id === 'walk')
    if (!scenario)
      throw new Error('Missing walk scenario')
    const cues = scenario.timeline(1, 120)
    expect(cues.map(cue => cue.kind === 'goal' ? cue.x : null)).toEqual([30, 0])
    expect(cues[0].at).toBeLessThan(1)
    expect(cues[1].at).toBeGreaterThanOrEqual(60)
    expect(cues[1].at).toBeLessThan(61)
  })

  it('provides twelve labelled voice peaks with bounded 60 Hz envelopes', () => {
    const scenario = motion3dScenarios.find(scenario => scenario.id === 'speak')
    if (!scenario)
      throw new Error('Missing speak scenario')
    const cues = scenario.timeline(1, 60)
    let peaks = 0
    for (const cue of cues) {
      if (cue.kind !== 'voice')
        throw new Error('Expected a voice turn')
      peaks += cue.emphasis.length
      expect(cue.envelope).toHaveLength(Math.ceil(cue.seconds * 60))
      expect(cue.envelope.every(level => level >= 0 && level <= 1)).toBe(true)
      expect(cue.emphasis.every(peak => peak.at >= 0 && peak.at < cue.seconds)).toBe(true)
    }
    expect(peaks).toBe(12)
  })

  it('covers every emotion three times across seeds one to six with unique pooled trial ids', () => {
    const scenario = motion3dScenarios.find(scenario => scenario.id === 'emotions')
    if (!scenario)
      throw new Error('Missing emotions scenario')
    const coverage = new Map<string, number>()
    const trialIds: string[] = []
    for (let seed = 1; seed <= 6; seed++) {
      const cues = scenario.timeline(seed, 120)
      const emotions = cues.filter(cue => cue.kind === 'emotion')
      const placebos = cues.filter(cue => cue.kind === 'placebo')
      const gestures = cues.filter(cue => cue.kind === 'gesture')
      expect(emotions).toHaveLength(6)
      expect(placebos).toHaveLength(2)
      expect(gestures.map(cue => cue.gesture).sort()).toEqual(['glance', 'lean', 'nod', 'shake', 'shrug'])
      expect(gestures.every(cue => cue.at >= 100 && cue.at < 120)).toBe(true)
      const trials = [...emotions, ...placebos].sort((a, b) => a.at - b.at)
      for (let i = 1; i < trials.length; i++)
        expect(trials[i].at - trials[i - 1].at).toBeCloseTo(12, 10)
      for (const cue of emotions) {
        coverage.set(cue.emotion, (coverage.get(cue.emotion) ?? 0) + 1)
        expect(cue.band).toBe('clear')
      }
      for (const cue of trials) {
        if (cue.trialId === undefined)
          throw new Error('Missing trial id')
        trialIds.push(cue.trialId)
      }
    }
    expect(Object.fromEntries(coverage)).toEqual(Object.fromEntries(PERFORMANCE_EMOTIONS.map(emotion => [emotion, 3])))
    expect(new Set(trialIds).size).toBe(48)
  })
})
