import type { ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import type { MindMoodState } from './mood'
import type { MindStimulus } from './types'

import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import { defaultExpressionPerformanceSettings as defaults } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { CharacterMind } from './mind'
import { initialMindMoodState, moodEpisodeDose, moodLevelAt, moodTouchDose } from './mood'
import { step } from './step'
import { allCapabilities, naturalMindState } from './test/fixtures'

function episode(overrides: Partial<ReactionEpisode> = {}): ReactionEpisode {
  return { id: 'one', emotion: 'happy', intensity: 0.9, nominal: 0.9, band: 'strong', escalation: false, ...overrides }
}

function dimensions(mood: MindMoodState) {
  return [mood.valence, mood.arousal, mood.tension]
}

/** Doses `episodes` in order at `atMs`, keeping the mood. */
function doseAll(episodes: ReactionEpisode[], atMs = 0, moodless = false) {
  let mood = initialMindMoodState
  const doses = episodes.map((each) => {
    const answer = moodEpisodeDose(mood, each, defaults, moodless, atMs)
    mood = answer.mood
    return answer.dose
  })
  return { mood, doses }
}

describe('mind mood', () => {
  it('doses a new episode by its band gain, intensity, and emotion coefficients', () => {
    const { mood, doses } = doseAll([episode({ band: 'clear', intensity: 0.6 })], 1000)
    const dose = defaults.moodDynamics.clearGain * 0.6
    const [valence, arousal, tension] = naturalEmotions.happy.mood
    expect(doses).toEqual([{ id: 'one@1000', valence: dose * valence, arousal: dose * arousal, tension: dose * tension }])
    expect(dimensions(mood)).toEqual([dose * valence, dose * arousal, Math.max(0, dose * tension)])
  })

  it('adds only the escalation dose delta and ignores duplicates and stale ids', () => {
    let { mood } = doseAll([episode({ band: 'clear', intensity: 0.6 })])
    const escalated = moodEpisodeDose(mood, episode({ escalation: true }), defaults, false, 2000)
    expect(escalated.dose?.valence).toBeCloseTo((0.4 * 0.9 - 0.25 * 0.6) * 0.7, 14)
    mood = escalated.mood
    for (const repeat of [episode({ escalation: true }), episode(), episode({ id: 'missing', escalation: true })])
      expect(moodEpisodeDose(mood, repeat, defaults, false, 3000)).toEqual({ mood, dose: null })
  })

  it('retires the bookkeeping of a replaced episode, so its escalation is stale', () => {
    const { mood } = doseAll([episode({ id: 'a' }), episode({ id: 'b', emotion: 'sad' })])
    expect(moodEpisodeDose(mood, episode({ id: 'a', escalation: true, intensity: 1 }), defaults, false, 0).dose).toBeNull()
    expect(moodEpisodeDose(mood, episode({ id: 'b', emotion: 'angry', escalation: true, intensity: 1 }), defaults, false, 0).dose).toBeNull()
  })

  it('doses nothing for a moodless episode but records it, so a later escalation adds its full dose', () => {
    const { mood, doses } = doseAll([episode({ band: 'clear', intensity: 0.6 })], 0, true)
    expect(doses).toEqual([null])
    expect(dimensions(mood)).toEqual([0, 0, 0])
    const escalated = moodEpisodeDose(mood, episode({ escalation: true }), defaults, false, 0)
    expect(escalated.dose?.valence).toBeCloseTo(0.4 * 0.9 * 0.7, 14)
  })

  it('ignores a nonpositive or NaN intensity', () => {
    for (const intensity of [0, -1, Number.NaN])
      expect(moodEpisodeDose(initialMindMoodState, episode({ intensity }), defaults, false, 0)).toEqual({ mood: initialMindMoodState, dose: null })
  })

  it('bounds fifty strong angry doses like the performer', () => {
    const { mood } = doseAll(Array.from({ length: 50 }, (_, i) => episode({ id: String(i), emotion: 'angry' })))
    expect(dimensions(mood)).toEqual([-1, 1, 1])
  })

  it('decays with the dose settings\' time constants, independently of how the span is split', () => {
    const { mood } = doseAll([episode({ emotion: 'angry' })], 1000)
    const level = moodLevelAt(mood, 3000)
    expect(level.valence).toBeCloseTo(mood.valence * Math.exp(-2 / defaults.moodDynamics.valenceTau), 14)
    expect(level.arousal).toBeCloseTo(mood.arousal * Math.exp(-2 / defaults.moodDynamics.arousalTau), 14)
    expect(level.tension).toBeCloseTo(mood.tension * Math.exp(-2 / defaults.moodDynamics.tensionTau), 14)
    const half = moodLevelAt({ ...mood, ...moodLevelAt(mood, 2000), atMs: 2000 }, 3000)
    dimensions({ ...mood, ...half }).forEach((value, i) => expect(Math.abs(value - Object.values(level)[i])).toBeLessThan(1e-12))
    expect(moodLevelAt(mood, 500)).toEqual({ valence: mood.valence, arousal: mood.arousal, tension: mood.tension })
  })

  it('releases at once with zero time constants', () => {
    const zero = { ...defaults, moodDynamics: { ...defaults.moodDynamics, valenceTau: 0, arousalTau: 0, tensionTau: 0 } }
    const { mood } = moodEpisodeDose(initialMindMoodState, episode({ emotion: 'angry' }), zero, false, 0)
    expect(moodLevelAt(mood, 1)).toEqual({ valence: 0, arousal: 0, tension: 0 })
  })

  it('adds a touch dose with the performer\'s clamps and ignores a nonfinite one', () => {
    const touched = moodTouchDose(initialMindMoodState, { id: 'touch-1', valence: 5, arousal: -5, tension: 5 }, defaults, 0)
    expect(dimensions(touched)).toEqual([1, -1, 1])
    expect(moodTouchDose(touched, { id: 'touch-2', valence: Number.NaN, arousal: 0, tension: 0 }, defaults, 0)).toBe(touched)
  })
})

describe('step: mood', () => {
  const emotion = (nominal: number, overrides: Partial<Extract<MindStimulus, { kind: 'emotion' }>> = {}): MindStimulus => ({ kind: 'emotion', source: 'act', emotion: 'happy', nominal, turnId: 'A', settings: { ...defaults, intensity: { ...defaults.intensity, jitter: 0 } }, ...overrides })

  it('follows an episode with its dose after the gesture, and an escalation with its delta', () => {
    const first = step(naturalMindState(), [emotion(0.6)], 1000, () => 0.5)
    expect(first.intents.map(intent => intent.kind)).toEqual(['emotion', 'emotion-gesture', 'mood'])
    expect(first.intents[2]).toMatchObject({ id: '1-mood', channel: 'posture', dose: { id: 'happy-1@1000' } })
    const escalated = step(first.state, [emotion(0.9)], 1500, () => 0.5)
    expect(escalated.intents.map(intent => intent.kind)).toEqual(['emotion', 'mood'])
    expect(escalated.intents[1]).toMatchObject({ dose: { id: 'happy-1@1500', valence: expect.closeTo((0.4 * 0.9 - 0.25 * 0.6) * 0.7, 12) } })
  })

  it('doses nothing for a moodless turn or with mood off', () => {
    for (const overrides of [{ moodless: true }, { settings: { ...defaults, mood: false } }]) {
      const { intents, state } = step(naturalMindState(), [emotion(0.6, overrides)], 0, () => 0.5)
      expect(intents.map(intent => intent.kind)).not.toContain('mood')
      expect(dimensions(state.mood)).toEqual([0, 0, 0])
    }
  })

  it('moves her level without posture and reports the dose undeclared', () => {
    const faceOnly = { ...naturalMindState(), performer: { ...allCapabilities, posture: false } }
    const { state, refusals } = step(faceOnly, [emotion(0.6)], 0, () => 0.5)
    expect(refusals).toContainEqual({ cause: 1, kind: 'mood', reason: 'undeclared' })
    expect(state.mood.valence).toBeGreaterThan(0)
  })

  it('adds a touch dose to her level only with mood on', () => {
    const poke = (mood: boolean): MindStimulus => ({ kind: 'touch', gesture: 'poke', region: 'head', point: { x: 0, y: 0 }, settings: { ...defaults, mood }, voice: null })
    const on = step(naturalMindState(), [poke(true)], 0, () => 0.5)
    const dose = on.intents.find(intent => intent.kind === 'mood')
    expect(dose?.kind === 'mood' && [dose.dose.valence, dose.dose.arousal, dose.dose.tension]).toEqual(dimensions(on.state.mood))
    expect(dimensions(step(naturalMindState(), [poke(false)], 0, () => 0.5).state.mood)).toEqual([0, 0, 0])
  })

  it('gives the level decayed to its clock for a seed', () => {
    const mind = new CharacterMind({ seed: 1, clock: (() => {
      const times = [1000, 1000]
      return () => times.shift() ?? 11_000
    })() })
    mind.receive({ kind: 'performer', capabilities: allCapabilities })
    mind.receive(emotion(0.6))
    const dosed = mind.state.mood
    expect(mind.moodLevel()).toEqual(moodLevelAt(dosed, 11_000))
    expect(mind.moodLevel().valence).toBeLessThan(dosed.valence)
  })
})
