import type { NaturalIdleDrive } from '@proj-airi/motion-driver-natural/idle-activities'
import type { IdleView } from '@proj-airi/motion-driver-natural/idle-schedule'

import type { MindRandom, MindState, MindStimulus } from './types'

import { randomSource } from '@proj-airi/stage-shared/situation'
import { describe, expect, it } from 'vitest'

import { nextIdleWakeAt } from './idle'
import { CharacterMind } from './mind'
import { step } from './step'
import { naturalMindState } from './test/fixtures'

const T0 = 1_700_000_000_000
const drive: NaturalIdleDrive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, rate: 1 }
const view: IdleView = { drive, active: true, mode: 'idle', away: false, blocked: false, current: null, errand: null }
const viewed: MindStimulus = { kind: 'idle', reports: [{ kind: 'view', view }] }
const musicOn: MindStimulus = { kind: 'music', playing: true }

/** A seeded source that counts its draws. */
function counted(seed: number) {
  const random = randomSource(seed)
  const source = Object.assign((() => {
    source.draws += 1
    return random()
  }) as MindRandom & { draws: number }, { draws: 0 })
  return source
}

describe('music stimulus', () => {
  it('draws nothing and yields nothing, before and after the idle stream is seeded', () => {
    const rng = counted(1)
    const started = step(naturalMindState(), [musicOn], T0, rng)
    expect([started.intents, rng.draws, started.state.music]).toEqual([[], 0, { playing: true }])
    const idle = step(started.state, [viewed], T0, rng).state
    const draws = rng.draws
    const stopped = step(idle, [{ kind: 'music', playing: false }], T0 + 1000, rng)
    expect([stopped.intents, rng.draws - draws, stopped.state.music]).toEqual([[], 0, { playing: false }])
    expect(stopped.state.idle.random).toBe(idle.idle.random)
  })

  it('leaves the idle seed unchanged when it reaches the mind before the first idle report', () => {
    const plain = step(naturalMindState(), [viewed], T0, randomSource(1)).state
    const rng = randomSource(1)
    const heard = step(step(naturalMindState(), [musicOn], T0, rng).state, [viewed], T0, rng).state
    expect(heard.idle.random).toBe(plain.idle.random)
    expect(heard.idle.schedule).toEqual(plain.idle.schedule)
    expect(nextIdleWakeAt(heard.idle)).toBe(nextIdleWakeAt(plain.idle))
  })

  it('round-trips the state through JSON', () => {
    const state: MindState = step(naturalMindState(), [musicOn, viewed], T0, randomSource(1)).state
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it('forgets the music at a reset', () => {
    const mind = new CharacterMind({ seed: 1, clock: () => T0 })
    mind.receive(musicOn)
    expect(mind.state.music.playing).toBe(true)
    mind.reset({ pacing: null })
    expect(mind.state.music.playing).toBe(false)
  })
})
