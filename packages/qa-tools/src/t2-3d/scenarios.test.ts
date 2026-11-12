import { GOAL_MIN_DWELL_MS } from '@proj-airi/motion-driver-humanoid/director'
import { PERFORMANCE_EMOTIONS } from '@proj-airi/stage-shared/expression-performance'
import { LAYER_FADE_SECONDS } from '@proj-airi/stage-ui-mmd/composables/mmd/layer-fade'
import { describe, expect, it } from 'vitest'

import { motion3dScenarios } from './scenarios'

describe('motion3d scenario timelines', () => {
  // Default seed-1 counts; gaze count varies with seeded hold/return durations.
  const counts = { 'idle': 1, 'gaze-shift': 18, 'speak': 11, 'gesture-under-clip': 9, 'emotions': 13, 'walk': 6, 'touch': 10, 'sleepy-no-clip': 4 } as const
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

  it('walks version 3: right, back left, a turn-around and short legs at walk pace, each cue at least 2 s after the previous leg ends', () => {
    const scenario = motion3dScenarios.find(scenario => scenario.id === 'walk')
    if (!scenario)
      throw new Error('Missing walk scenario')
    expect([scenario.version, scenario.seconds]).toEqual([3, 60])
    for (const seed of [1, 2]) {
      const goals = scenario.timeline(seed, 120).flatMap(cue => cue.kind === 'goal' ? [cue] : [])
      expect(goals.map(goal => [goal.at, goal.x, goal.pace])).toEqual([[0.5, 19.5, 'walk'], [28, 8, 'walk'], [33, 19, 'walk'], [45, 16, 'walk'], [54.5, 19, 'walk'], [64, 16, 'walk']])
      goals.slice(1).forEach((goal, i) => expect(goal.at - goals[i].at).toBeGreaterThanOrEqual(GOAL_MIN_DWELL_MS / 1000))
    }
  })

  it('rests without clips: idle from the start after a 100 s warm-up, away at 40 s and listening at 80 s, recording stance reasons', () => {
    const scenario = motion3dScenarios.find(scenario => scenario.id === 'sleepy-no-clip')
    if (!scenario)
      throw new Error('Missing sleepy-no-clip scenario')
    expect([scenario.version, scenario.class, scenario.warmupSeconds, scenario.seconds, scenario.maxSeconds, scenario.recordStance]).toEqual([1, 'idle', 100, 120, 600, true])
    const activity = scenario.timeline(1, 120).flatMap(cue => cue.kind === 'activity' ? [[cue.at, cue.mode, cue.away ?? false]] : [])
    expect(activity).toEqual([[0, 'idle', false], [40, 'idle', true], [80, 'listening', false]])
    expect(motion3dScenarios.filter(scenario => scenario.recordStance).map(scenario => scenario.id)).toEqual(['sleepy-no-clip'])
  })

  it.each([1, 2, 3])('speaks version 2 for seed %i: fifteen peaks at least 0.9 s apart, three energies and one chat reply', (seed) => {
    const scenario = motion3dScenarios.find(scenario => scenario.id === 'speak')
    if (!scenario)
      throw new Error('Missing speak scenario')
    expect(scenario.version).toBe(2)
    const cues = scenario.timeline(seed, 60)
    const voices = cues.flatMap(cue => cue.kind === 'voice' ? [cue] : [])
    expect(voices.map(cue => cue.seconds)).toEqual([8, 8, 8])
    for (const cue of voices) {
      expect(cue.emphasis).toHaveLength(5)
      expect(cue.envelope).toHaveLength(8 * 60)
      expect(cue.envelope.every(level => level >= 0 && level <= 1)).toBe(true)
      expect(cue.emphasis.every(peak => peak.at >= 0 && peak.at < cue.seconds && peak.strength >= 0.35 && peak.strength <= 0.95)).toBe(true)
      cue.emphasis.slice(1).forEach((peak, i) => expect(peak.at - cue.emphasis[i].at).toBeGreaterThanOrEqual(0.9))
      // The utterance's energy is set as it starts.
      expect(cues.find(other => other.kind === 'energy' && other.at === cue.at)).toBeDefined()
    }
    const levels = cues.flatMap(cue => cue.kind === 'energy' && voices.some(voice => voice.at === cue.at) ? [cue.level] : [])
    expect(levels.sort()).toEqual([0.45, 0.65, 0.85])
    const shown = cues.filter(cue => cue.kind === 'chat' && cue.target !== null)
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ unfold: true })
    expect(voices.filter(voice => voice.at > shown[0].at && voice.at - shown[0].at <= 0.5)).toHaveLength(1)
  })

  // Version 3 (E/g3/own2/rules-v2.md): every time follows from the timeline's own labelled peaks and utterances, by one
  // rule for every seed. Seeds 1 to 6 are the criterion's pool.
  it('claims and pokes 50 ms after the A peaks nearest 3 s and 5 s, releases in the silence after B, and claims and releases again 50 ms after C\'s first and third peaks, for seeds 1 to 6', () => {
    const scenario = motion3dScenarios.find(scenario => scenario.id === 'gesture-under-clip')
    if (!scenario)
      throw new Error('Missing gesture-under-clip scenario')
    expect(scenario.version).toBe(3)
    for (let seed = 1; seed <= 6; seed++) {
      const cues = scenario.timeline(seed, 30)
      const [a, b, c] = cues.flatMap(cue => cue.kind === 'voice' ? [cue] : [])
      const [claim, second] = cues.filter(cue => cue.kind === 'clip-claim')
      const [release, secondRelease] = cues.filter(cue => cue.kind === 'clip-release')
      const poke = cues.find(cue => cue.kind === 'touch')
      if (!claim || !second || !release || !secondRelease || poke?.kind !== 'touch')
        throw new Error('Expected two claims, a poke and two releases')
      const nearestA = (t: number) => a.emphasis.map(peak => a.at + peak.at).reduce((best, peak) => Math.abs(peak - t) < Math.abs(best - t) ? peak : best)
      expect(claim.at).toBeCloseTo(nearestA(3) + 0.05, 9)
      expect(poke.at).toBeCloseTo(nearestA(5) + 0.05, 9)
      const full = { from: claim.at + LAYER_FADE_SECONDS.upperIn, to: release.at }
      expect(poke.at).toBeGreaterThan(full.from)
      expect(poke.at).toBeLessThan(a.at + a.seconds)
      expect(release.at).toBeCloseTo(b.at + b.seconds + 1.5, 9)
      // The stale window and the rest instant close before C can start a unit.
      expect(c.at).toBeGreaterThanOrEqual(release.at + 1 + LAYER_FADE_SECONDS.upperOut)
      const peaks = [a, b].flatMap(voice => voice.emphasis.map(peak => voice.at + peak.at))
      expect(full.to - full.from).toBeGreaterThanOrEqual(8)
      expect(peaks.filter(t => t >= full.from && t <= full.to).length).toBeGreaterThanOrEqual(3)
      // Revision B: the second claim and release follow C's labelled peaks, after the first release's stale window, and
      // its own stale window closes inside the run.
      const cPeaks = c.emphasis.map(peak => c.at + peak.at)
      expect(second.at).toBeCloseTo(cPeaks[0] + 0.05, 9)
      expect(secondRelease.at).toBeCloseTo(cPeaks[2] + 0.05, 9)
      expect(second.at).toBeGreaterThan(release.at + 1 + LAYER_FADE_SECONDS.upperOut)
      expect(secondRelease.at + 1 + LAYER_FADE_SECONDS.upperOut).toBeLessThan(30)
    }
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
