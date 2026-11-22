import type { MindState, MindStimulus } from './types'

import { describe, expect, it } from 'vitest'

import { seededRandom } from './random'
import { initialMindState, step } from './step'

const SEC = 1000
/** Epoch milliseconds of the first stimulus of every script. */
const T0 = 1_700_000_000_000
const SPAN = 600 * SEC

const goAway: MindStimulus = { kind: 'presence', away: true, wake: null }
const comeBack: MindStimulus = { kind: 'presence', away: false, wake: null }
const screenChange: MindStimulus = { kind: 'screen-change' }

function unlock(atMs: number, away = false): MindStimulus {
  return { kind: 'presence', away, wake: { cause: 'unlock', atMs } }
}

/** One mind fed in order with a seeded source. */
function script() {
  const rng = seededRandom(7)
  let state: MindState = initialMindState()
  return {
    get state() { return state },
    send(atMs: number, ...stimuli: MindStimulus[]) {
      const answer = step(state, stimuli, atMs, rng)
      state = answer.state
      return answer.intents
    },
  }
}

const shape = (intents: { channel: string, kind: string }[]) => intents.map(intent => `${intent.channel}/${intent.kind}`)

describe('answerPresence', () => {
  it('answers each away edge once and ignores repeated presence readings', () => {
    const mind = script()
    const awayIntents = (intents: ReturnType<typeof mind.send>) => intents.filter(intent => intent.kind === 'away')

    expect(awayIntents(mind.send(T0, comeBack))).toEqual([])
    expect(awayIntents(mind.send(T0 + SEC, goAway))).toEqual([{ id: '2-away', cause: 2, channel: 'body', kind: 'away', away: true }])
    expect(awayIntents(mind.send(T0 + 2 * SEC, goAway))).toEqual([])
    expect(awayIntents(mind.send(T0 + 3 * SEC, comeBack))).toEqual([{ id: '4-away', cause: 4, channel: 'body', kind: 'away', away: false }])
    expect(awayIntents(mind.send(T0 + 4 * SEC, comeBack))).toEqual([])
  })

  it('opens a span with one away intent', () => {
    const mind = script()

    expect(mind.send(T0, goAway)).toEqual([{ id: '1-away', cause: 1, channel: 'body', kind: 'away', away: true }])
    expect(mind.state.presence).toEqual({ away: true, awaySinceMs: T0 })
  })

  it('answers a return with one wake, one welcome-back moment, and one observe-return over the span', () => {
    const mind = script()
    mind.send(T0, goAway)
    const intents = mind.send(T0 + SPAN, comeBack)

    expect(shape(intents)).toEqual(['posture/wake', 'face/moment', 'voice/observe-return', 'body/away'])
    expect(intents[1]).toMatchObject({ moment: 'welcome-back' })
    expect(intents[2]).toMatchObject({ atMs: T0 + SPAN, awayMs: SPAN })
    expect(new Set(intents.map(intent => intent.cause)).size).toBe(1)
    expect(mind.state.presence).toEqual({ away: false, awaySinceMs: null })
  })

  it('answers a return with a wake with the startle instead of the gentle wake, and observes the wake first', () => {
    const mind = script()
    mind.send(T0, goAway)
    const intents = mind.send(T0 + SPAN, unlock(T0 + SPAN))

    expect(shape(intents)).toEqual(['posture/desktop-reaction', 'face/moment', 'voice/observe-wake', 'voice/observe-return', 'body/away'])
    expect(intents[0]).toMatchObject({ reaction: 'wake' })
    expect(intents[2]).toMatchObject({ wakeCause: 'unlock', awayMs: SPAN })
  })

  it('reacts to a wake while away, reports the open span, and keeps the span open', () => {
    const mind = script()
    mind.send(T0, goAway)
    const intents = mind.send(T0 + SPAN, unlock(T0 + SPAN, true))

    expect(shape(intents)).toEqual(['posture/desktop-reaction', 'voice/observe-wake'])
    expect(intents[1]).toMatchObject({ awayMs: SPAN })
    expect(mind.state.presence).toEqual({ away: true, awaySinceMs: T0 })
  })

  it('reports a wake with no span as awayMs null', () => {
    const intents = script().send(T0, unlock(T0))

    expect(shape(intents)).toEqual(['posture/desktop-reaction', 'voice/observe-wake'])
    expect(intents[1]).toMatchObject({ awayMs: null })
  })
})

describe('answerScreenChange', () => {
  it('reacts once, not again within 10 s, and again after it', () => {
    const mind = script()

    expect(shape(mind.send(T0, screenChange))).toEqual(['posture/desktop-reaction'])
    expect(mind.send(T0 + 9 * SEC, screenChange)).toEqual([])
    expect(shape(mind.send(T0 + 10 * SEC, screenChange))).toEqual(['posture/desktop-reaction'])
  })

  it('drops a screen change in the same call as a wake', () => {
    const intents = script().send(T0, screenChange, unlock(T0))

    expect(intents.filter(intent => intent.kind === 'desktop-reaction')).toEqual([expect.objectContaining({ reaction: 'wake' })])
  })
})

it('keeps a state that survives a JSON round trip', () => {
  const mind = script()
  mind.send(T0, goAway, screenChange)

  expect(JSON.parse(JSON.stringify(mind.state))).toEqual(mind.state)
})
