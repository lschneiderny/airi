import type { GateOutcome, ReactionHoldReason, TouchVoiceView } from '@proj-airi/stage-shared/situation'

import type { MindIntent, MindState, MindStimulus } from './types'

import { defaultExpressionPerformanceSettings as settings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { seededRandom } from './random'
import { initialMindState, step } from './step'

const rng = seededRandom(17)
const SEC = 1000
/** Epoch milliseconds of the first touch of every script. */
const T0 = 1_700_000_000_000
/** A seed whose voice checkpoint first draws 0.248, 0.533, and 0.077: every line that reaches its roll speaks. */
const SPEAKS = 17
/** A seed whose voice checkpoint first draws 0.891, above the odds of a protest. */
const HOLDS = 3
const EVENT_ID = 'touch-event'
// Default units: slight 0.15 x 0.25, clear 0.25 x 0.6.
const slight = 0.0375

type Touch = Extract<MindStimulus, { kind: 'touch' }>

function view(overrides: Partial<TouchVoiceView> = {}): TouchVoiceView {
  return { sessionId: 'session-1', eventId: EVENT_ID, pet: null, pokeTimesMs: [], lastCharacterLineAtMs: null, held: null, ...overrides }
}

function poke(voice: TouchVoiceView | null = null, region: 'head' | 'body' = 'head'): Touch {
  return { kind: 'touch', gesture: 'poke', region, point: { x: 0.2, y: -0.4 }, settings, voice }
}

const petStart: Touch = { kind: 'touch', gesture: 'pet-start', region: 'head', settings, voice: null }

function petEnd(durationMs: number, voice: TouchVoiceView | null = null): Touch {
  return { kind: 'touch', gesture: 'pet-end', region: 'head', durationMs, settings, voice }
}

/** One mind fed in order; every poke carries the view of the pokes so far, as the situation reports them. */
function script(seed = SPEAKS) {
  let state = initialMindState(seed)
  const pokeTimesMs: number[] = []
  function send(atMs: number, stimulus: MindStimulus) {
    const answer = step(state, [stimulus], atMs, rng)
    state = answer.state
    return answer.intents
  }
  function pokeAt(atMs: number, overrides: Partial<TouchVoiceView> = {}) {
    pokeTimesMs.push(atMs)
    return send(atMs, poke(view({ pokeTimesMs: [...pokeTimesMs], ...overrides })))
  }
  return {
    get state() { return state },
    get decision() { return state.voice.lastDecision },
    send,
    pokeAt,
    /** Three pokes one second apart; returns the intents of the third. */
    burstAt(atMs: number) {
      pokeAt(atMs)
      pokeAt(atMs + SEC)
      return pokeAt(atMs + 2 * SEC)
    },
    outcomeAt(atMs: number, outcome: GateOutcome | 'refused', eventId = EVENT_ID) {
      return send(atMs, { kind: 'voice-outcome', eventId, outcome })
    },
  }
}

function kinds(intents: readonly MindIntent[]) {
  return intents.map(intent => `${intent.channel}/${intent.kind}`)
}

describe('step: touch', () => {
  it('answers a poke with a touch reaction at its point, a mood dose, and a moment, under one cause', () => {
    const { state, intents } = step(initialMindState(SPEAKS), [poke(null, 'body')], T0, rng)

    expect(intents).toEqual([
      { id: '1-touch-reaction', cause: 1, channel: 'posture', kind: 'touch-reaction', gesture: 'poke', region: 'body', point: { x: 0.2, y: -0.4 } },
      { id: '1-mood', cause: 1, channel: 'posture', kind: 'mood', dose: { id: 'touch-1-poke', valence: 0, arousal: slight * 0.6, tension: 0 } },
      { id: '1-moment', cause: 1, channel: 'face', kind: 'moment', moment: 'poked' },
    ])
    expect(state.seq).toBe(1)
  })

  it('answers every touch with a touch reaction, also when the dose is paced away', () => {
    const mind = script()

    expect(kinds(mind.send(T0, poke()))).toEqual(['posture/touch-reaction', 'posture/mood', 'face/moment'])
    // Inside the 1 s poke cooldown: no dose, but the body still reacts and the moment is still hers to mark.
    expect(kinds(mind.send(T0 + 0.5 * SEC, poke()))).toEqual(['posture/touch-reaction', 'face/moment'])
    expect(mind.send(T0 + 2 * SEC, petStart)).toMatchObject([{ kind: 'touch-reaction', gesture: 'pet', phase: 'start' }, { kind: 'mood' }])
    expect(mind.send(T0 + 3 * SEC, petEnd(1 * SEC))).toMatchObject([{ kind: 'touch-reaction', gesture: 'pet', phase: 'end' }, { kind: 'moment', moment: 'petted' }])
  })

  it('doses a pet at its start and escalates a long pet at its end, counting seconds on the mind clock', () => {
    const mind = script()

    const start = mind.send(T0, petStart)
    expect(start[1]).toMatchObject({ kind: 'mood', dose: { id: 'touch-1-pet', valence: slight, arousal: 0, tension: -slight / 2 } })
    const end = mind.send(T0 + 4 * SEC, petEnd(4 * SEC))
    expect(end[1]).toMatchObject({ kind: 'mood', dose: { id: 'touch-2-pet-long' } })
    expect(mind.state.touch.affect.lastAt).toBe((T0 + 4 * SEC) / 1000)
    // A touch never starts an emotion episode.
    expect(mind.state.reaction.current).toBeNull()
  })

  it('decides no line and leaves the voice memory untouched without a voice view', () => {
    const initial = initialMindState(SPEAKS)
    let state = initial
    for (const [index, stimulus] of [poke(), poke(), poke(), petStart, petEnd(5 * SEC)].entries())
      state = step(state, [stimulus], T0 + index * SEC, rng).state

    expect(state.voice).toBe(initial.voice)
  })

  it('decides no line for a pet start, whatever its view', () => {
    const initial = initialMindState(SPEAKS)
    const { state, intents } = step(initial, [{ ...petStart, voice: view() }], T0, rng)

    expect(kinds(intents)).toEqual(['posture/touch-reaction', 'posture/mood'])
    expect(state.voice).toBe(initial.voice)
  })
})

describe('step: the spoken touch reaction', () => {
  it('speaks once for a burst of three pokes, and rolls each burst once', () => {
    const mind = script()

    expect(kinds(mind.pokeAt(T0))).not.toContain('voice/speak')
    expect(mind.decision).toMatchObject({ speak: false, reason: 'poke-count', kind: 'poke-protest', roll: null })
    mind.pokeAt(T0 + SEC)
    const third = mind.pokeAt(T0 + 2 * SEC)

    expect(third.at(-1)).toEqual({ id: '3-speak', cause: 3, channel: 'voice', kind: 'speak', line: 'poke-protest', eventId: EVENT_ID })
    expect(mind.decision).toMatchObject({ speak: true, kind: 'poke-protest', eventId: EVENT_ID, probability: 0.8 })
    expect(mind.state.voice.reaction).toMatchObject({ sessionId: 'session-1', pokeBurstRolled: true, lastAttemptAtMs: T0 + 2 * SEC, pending: { kind: 'poke-protest', eventId: EVENT_ID } })

    expect(kinds(mind.pokeAt(T0 + 3 * SEC))).not.toContain('voice/speak')
    expect(mind.decision).toMatchObject({ speak: false, reason: 'burst-rolled', kind: 'poke-protest', roll: null })
  })

  it('holds a burst whose draw is at or above the odds, and keeps the draw in the decision', () => {
    const mind = script(HOLDS)

    expect(kinds(mind.burstAt(T0))).not.toContain('voice/speak')
    expect(mind.decision).toMatchObject({ speak: false, reason: 'roll', kind: 'poke-protest' })
    expect(mind.decision?.roll).toBeGreaterThanOrEqual(0.8)
    expect(mind.state.voice.reaction.pending).toBeNull()
  })

  it.each<[ReactionHoldReason, Touch]>([
    ['ignored', poke(view({ eventId: null, pokeTimesMs: [T0] }))],
    ['poke-count', poke(view({ pokeTimesMs: [T0] }))],
    ['generating', poke(view({ pokeTimesMs: [T0 - 2 * SEC, T0 - SEC, T0], held: 'generating' }))],
    ['dont-disturb', poke(view({ pokeTimesMs: [T0 - 2 * SEC, T0 - SEC, T0], held: 'dont-disturb' }))],
    ['pet-short', petEnd(2 * SEC, view({ pet: { startedAtMs: T0 - 2 * SEC, durationMs: 2 * SEC } }))],
    ['first-pet', petEnd(5 * SEC, view({ pet: { startedAtMs: T0 - 5 * SEC, durationMs: 5 * SEC } }))],
  ])('holds with %s, draws nothing, and still reacts with the body', (reason, stimulus) => {
    const initial = initialMindState(SPEAKS)
    const { state, intents } = step(initial, [stimulus], T0, rng)

    expect(state.voice.lastDecision).toMatchObject({ speak: false, reason, roll: null })
    expect(state.voice.reaction.rngState).toBe(initial.voice.reaction.rngState)
    expect(kinds(intents)).toContain('posture/touch-reaction')
    expect(kinds(intents)).not.toContain('voice/speak')
  })

  it('speaks a soft line for the second long pet of a session, and stays silent right after her last line', () => {
    const second = (lastCharacterLineAtMs: number | null) => {
      let state = initialMindState(SPEAKS)
      state = step(state, [petEnd(5 * SEC, view({ pet: { startedAtMs: T0 - 5 * SEC, durationMs: 5 * SEC } }))], T0, rng).state
      const atMs = T0 + 30 * SEC
      return step(state, [petEnd(5 * SEC, view({ pet: { startedAtMs: atMs - 5 * SEC, durationMs: 5 * SEC }, lastCharacterLineAtMs }))], atMs, rng)
    }

    expect(second(null).intents.at(-1)).toMatchObject({ channel: 'voice', kind: 'speak', line: 'pet-soft', eventId: EVENT_ID })
    expect(second(T0 + 25 * SEC).state.voice.lastDecision).toMatchObject({ speak: false, reason: 'recent-line', kind: 'pet-soft' })
  })

  it('holds a new burst while the last line has no outcome yet', () => {
    const mind = script()
    mind.burstAt(T0)

    // A poke 10 s after the last one starts a new burst, whose third poke is a candidate again.
    expect(kinds(mind.burstAt(T0 + 13 * SEC))).not.toContain('voice/speak')
    expect(mind.decision).toMatchObject({ speak: false, reason: 'pending', kind: 'poke-protest' })
  })

  it('holds the next burst for the refractory after a spoken line', () => {
    const mind = script()
    mind.burstAt(T0)
    expect(mind.outcomeAt(T0 + 3 * SEC, 'spoken')).toEqual([])
    expect(mind.state.voice.reaction).toMatchObject({ lastLineAtMs: T0 + 3 * SEC, pending: null })

    mind.burstAt(T0 + 13 * SEC)

    expect(mind.decision).toMatchObject({ speak: false, reason: 'refractory', kind: 'poke-protest' })
  })

  it.each(['declined', 'cancelled', 'failed'] as const)('holds the next burst for the retry wait after a %s line', (outcome) => {
    const mind = script()
    mind.burstAt(T0)
    mind.outcomeAt(T0 + 3 * SEC, outcome)
    expect(mind.state.voice.reaction).toMatchObject({ lastAttemptAtMs: T0 + 2 * SEC, lastLineAtMs: null, pending: null })

    mind.burstAt(T0 + 13 * SEC)

    expect(mind.decision).toMatchObject({ speak: false, reason: 'retry-wait', kind: 'poke-protest' })
  })

  it('frees the burst of a refused line, so the next poke speaks at once', () => {
    const mind = script()
    mind.burstAt(T0)

    mind.outcomeAt(T0 + 2 * SEC, 'refused')

    // The line was never sent: no refractory and no retry wait, and the burst may roll again.
    expect(mind.state.voice.reaction).toMatchObject({ lastLineAtMs: null, lastAttemptAtMs: null, pokeBurstRolled: false, pending: null })
    expect(mind.pokeAt(T0 + 3 * SEC).at(-1)).toMatchObject({ channel: 'voice', kind: 'speak', line: 'poke-protest' })
  })

  it('starts the refractory for a line that speaks after its pending attempt was dropped', () => {
    const mind = script()
    mind.burstAt(T0)
    // A poke past the 30 s pending limit drops the attempt that still waits for its outcome.
    mind.pokeAt(T0 + 33 * SEC)
    expect(mind.state.voice.reaction.pending).toBeNull()

    mind.outcomeAt(T0 + 34 * SEC, 'spoken')

    expect(mind.state.voice.reaction).toMatchObject({ lastLineAtMs: T0 + 34 * SEC, pending: null })
    // The retry wait from the attempt is over, so only the refractory of the late line holds the next burst.
    mind.burstAt(T0 + 44 * SEC)
    expect(mind.decision).toMatchObject({ speak: false, reason: 'refractory', kind: 'poke-protest' })
  })

  it('leaves a pending line to its own outcome when another line reports', () => {
    const mind = script()
    mind.burstAt(T0)
    const pending = mind.state.voice

    mind.outcomeAt(T0 + 3 * SEC, 'declined', 'another-event')
    expect(mind.state.voice).toBe(pending)

    mind.outcomeAt(T0 + 4 * SEC, 'spoken', 'another-event')
    expect(mind.state.voice.reaction).toMatchObject({ lastLineAtMs: T0 + 4 * SEC, pending: { eventId: EVENT_ID } })
  })

  it('continues identically after a JSON round trip of the state', () => {
    const mind = script()
    mind.send(T0, petStart)
    mind.pokeAt(T0 + SEC)
    mind.pokeAt(T0 + 2 * SEC)
    const restored: MindState = JSON.parse(JSON.stringify(mind.state))
    const third = poke(view({ pokeTimesMs: [T0 + SEC, T0 + 2 * SEC, T0 + 3 * SEC] }))

    expect(restored).toEqual(mind.state)
    expect(step(restored, [third], T0 + 3 * SEC, rng)).toEqual(step(mind.state, [third], T0 + 3 * SEC, rng))
  })
})
