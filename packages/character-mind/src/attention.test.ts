import type { CursorReport } from '@proj-airi/motion-driver-natural/cursor-notice'
import type { NaturalIdleDrive } from '@proj-airi/motion-driver-natural/idle-activities'

import type { MindIntent, MindRandom, MindState, MindStimulus } from './types'

import { randomSource } from '@proj-airi/stage-shared/situation'
import { describe, expect, it } from 'vitest'

import { nextIdleWakeAt } from './idle'
import { initialMindState, step } from './step'

const T0 = 1_700_000_000_000
const drive: NaturalIdleDrive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, music: false, rate: 1 }

function cursor(requestId: number, band: CursorReport['band'] = 'medium'): MindStimulus {
  return { kind: 'cursor', report: { requestId, band, opportunity: 'moved' } }
}

/** One mind fed in order from one seeded source that counts its draws. */
function script(seed: number, initial: MindState = initialMindState()) {
  const source = randomSource(seed)
  let draws = 0
  const random: MindRandom = () => {
    draws++
    return source()
  }
  let state = initial
  return {
    get state() { return state },
    get draws() { return draws },
    send(atMs: number, ...stimuli: MindStimulus[]): MindIntent[] {
      const answer = step(state, stimuli, atMs, random)
      state = answer.state
      return answer.intents
    },
  }
}

function episodes(intents: readonly MindIntent[]) {
  return intents.map((intent) => {
    expect(intent.kind).toBe('cursor-episode')
    return intent.kind === 'cursor-episode' ? { requestId: intent.requestId, episode: intent.episode } : null
  })
}

describe('cursor attention', () => {
  it('seeds its stream with one draw of rng at the first cursor stimulus and draws none after', () => {
    const mind = script(3)
    expect(mind.state.attention.random).toBeNull()
    mind.send(T0, cursor(1))
    expect(mind.draws).toBe(1)
    expect(mind.state.attention.random).not.toBeNull()
    for (let i = 2; i <= 20; i++)
      mind.send(T0 + i * 1000, cursor(i, i % 2 ? 'far' : 'medium'))
    expect(mind.draws).toBe(1)
  })

  it('answers each report with one gaze cursor episode for its id, and nothing on another channel', () => {
    const mind = script(3)
    const intents = mind.send(T0, cursor(7, 'near'))
    expect(intents).toEqual([{ id: '1-cursor-episode', cause: 1, channel: 'gaze', kind: 'cursor-episode', requestId: 7, episode: expect.objectContaining({ band: 'near', engaging: true }) }])
  })

  it('gives equal episodes for equal seeds and other episodes for another seed', () => {
    const play = (seed: number) => {
      const mind = script(seed)
      return Array.from({ length: 12 }, (_, i) => episodes(mind.send(T0 + i * 1000, cursor(i + 1, i % 3 === 0 ? 'far' : 'medium')))).flat()
    }
    expect(play(5)).toEqual(play(5))
    expect(play(6)).not.toEqual(play(5))
  })

  it('continues identically after a JSON round trip of the state', () => {
    const straight = script(9)
    const before = Array.from({ length: 4 }, (_, i) => straight.send(T0 + i * 1000, cursor(i + 1)))
    const after = Array.from({ length: 6 }, (_, i) => straight.send(T0 + (i + 4) * 1000, cursor(i + 5)))

    const first = script(9)
    expect(Array.from({ length: 4 }, (_, i) => first.send(T0 + i * 1000, cursor(i + 1)))).toEqual(before)
    const resumed = script(9, JSON.parse(JSON.stringify(first.state)) as MindState)
    expect(Array.from({ length: 6 }, (_, i) => resumed.send(T0 + (i + 4) * 1000, cursor(i + 5)))).toEqual(after)
  })

  it('leaves the idle draws unchanged when cursor stimuli come between them', () => {
    const view: MindStimulus = { kind: 'idle', reports: [{ kind: 'view', view: { drive, active: true, mode: 'idle', away: false, blocked: false, settled: false, current: null, errand: null } }] }
    const firstAct = (withCursor: boolean) => {
      const mind = script(1)
      mind.send(T0, view)
      for (let i = 1; ; i++) {
        const wakeAt = nextIdleWakeAt(mind.state.idle)
        expect(wakeAt).not.toBeNull()
        const intents = withCursor ? mind.send(T0 + i * 700, cursor(i)) : []
        const due = intents.some(intent => intent.kind === 'idle-act') ? intents : mind.send(Math.max(wakeAt!, T0 + i * 700), { kind: 'idle-wake' })
        const act = due.find(intent => intent.kind === 'idle-act')
        if (act?.kind === 'idle-act')
          return { act: act.act, seed: act.seed }
        if (i > 1000)
          throw new Error('no idle act decided')
      }
    }
    const plain = firstAct(false)
    const interleaved = firstAct(true)
    expect(interleaved.act).toBe(plain.act)
    expect(interleaved.seed).toBe(plain.seed)
  })
})

describe('the attend window', () => {
  it('answers a drag release and a sent chat message with one attend of 60 s each, drawing nothing', () => {
    const mind = script(3)
    const dragged = mind.send(T0, { kind: 'interaction', source: 'drag' })
    const sent = mind.send(T0 + 1000, { kind: 'interaction', source: 'chat-send' })

    expect(dragged).toEqual([{ id: '1-attend', cause: 1, channel: 'body', kind: 'attend', target: 'cursor', windowMs: 60_000 }])
    expect(sent).toEqual([{ id: '2-attend', cause: 2, channel: 'body', kind: 'attend', target: 'cursor', windowMs: 60_000 }])
    expect(mind.draws).toBe(0)
    expect(mind.state.attention.random).toBeNull()
  })
})
