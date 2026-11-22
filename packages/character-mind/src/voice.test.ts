import type { CharacterPacingMemory, GateSignals, SituationState, UserGateMemory } from '@proj-airi/stage-shared/situation'

import type { MindIntent, MindRandom, MindSlowState, MindState, MindStimulus, VoiceRequest, VoiceRun, VoiceView } from './types'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { DOUBLE_TEXT_PROBABILITY, FLOOR_MS, HOUR_MS, initialSituationState, promotionUrgeMemory, randomSource, restoreGateMemory, visibilityRegainUrgeMemory } from '@proj-airi/stage-shared/situation'
import { describe, expect, it } from 'vitest'

import { initialMindState, step } from './step'
import { naturalMindState } from './test/fixtures'
import { nextVoiceWakeAt, WIDGET_DEADLINE_MARGIN_MS, WIDGET_START_WAIT_MS } from './voice'

const SEC = 1000
const MIN = 60 * SEC
const T0 = 1_700_000_000_000
/** Seed 13 draws a double-text roll below its odds at the first fire after a promotion. */
const SEED = 13

const QUIET: GateSignals = { userSpeaking: false, userTyping: false, characterSpeaking: false, generating: false, queued: 0, desktopFresh: true, foregroundFresh: true, stageVisible: true }

/** A user at the desk who accepts remarks, with nothing on the screen worth a word. */
const situation: SituationState = {
  ...initialSituationState,
  presence: { state: 'here', reason: null, sinceMs: T0 - HOUR_MS },
  busy: { state: 'accepts', atMs: T0 },
  activity: { appId: 'notepad', label: 'Notepad', category: 'editor', title: null, sinceMs: T0 - 10 * MIN },
  nowMs: T0,
}

function view(overrides: Partial<Omit<VoiceView, 'run' | 'signals'>> & { run?: Partial<VoiceRun>, signals?: Partial<GateSignals> } = {}): VoiceView {
  return {
    situation,
    threads: { threads: { threads: [] } },
    // 16:00 local: no ritual is open.
    local: { dayKey: '2023-11-14', minuteOfDay: 16 * 60 },
    sessionId: 'chat-a',
    settings: { enabled: true, chattiness: 0.5, dontDisturb: false, quietApps: [], speakDuringGames: true },
    moodFactor: 1,
    unpromptedPending: false,
    ...overrides,
    run: { id: 1, user: null, ...overrides.run },
    signals: { ...QUIET, ...overrides.signals },
  }
}

function tick(overrides: Parameters<typeof view>[0] = {}, forceTiming = false): MindStimulus {
  return { kind: 'voice-tick', view: view(overrides), forceTiming }
}

/** One mind fed in order from one seeded source that counts its draws. */
function script(seed = SEED, slow?: MindSlowState) {
  const source = randomSource(seed)
  let draws = 0
  const random: MindRandom = () => {
    draws++
    return source()
  }
  let state = naturalMindState(slow)
  return {
    get state() { return state },
    get gate() { return state.voice.gate! },
    get draws() { return draws },
    send(atMs: number, ...stimuli: MindStimulus[]): MindIntent[] {
      const answer = step(state, stimuli, atMs, random)
      state = answer.state
      return answer.intents
    },
  }
}

function speakOf(intents: readonly MindIntent[]) {
  const speaks = intents.filter(intent => intent.kind === 'speak')
  expect(speaks).toHaveLength(1)
  return speaks[0] as Extract<MindIntent, { kind: 'speak' }>
}

const user: UserGateMemory = { lastFireAtMs: T0 - 30 * MIN, fires: [T0 - 30 * MIN], day: null }
const pacing: CharacterPacingMemory = { lastSpokenAtMs: T0 - 30 * MIN, unanswered: 2, awaitingSinceMs: T0 - 30 * MIN, damp: null, lastOwnDayAtMs: null }

describe('voice-tick', () => {
  it('keeps the reach-out and its random stream without an undeclared cue', () => {
    const naturalRandom = randomSource(SEED)
    const undeclaredRandom = randomSource(SEED)
    const stimulus = tick({}, true)
    const natural = step(naturalMindState(), [stimulus], T0, naturalRandom)
    const undeclared = step(initialMindState(), [stimulus], T0, undeclaredRandom)
    expect(undeclared.intents).toEqual(natural.intents.filter(intent => intent.channel === 'voice'))
    expect(undeclared.intents.map(intent => intent.kind)).toEqual(['speak'])
    expect(undeclared.refusals).toEqual([{ cause: 1, kind: 'cue', reason: 'undeclared' }])
    expect(undeclaredRandom()).toBe(naturalRandom())
  })
  it('restores a new run from the user\'s slice and her pacing over a promotion, normalized at the tick', () => {
    // A stored time ahead of the tick (the clock moved back) is pulled back to it.
    const ahead = { ...pacing, lastOwnDayAtMs: T0 + HOUR_MS }
    const mind = script(SEED, { pacing: ahead })
    // A pending unprompted turn skips the gate, so the memory stays as restored.
    mind.send(T0, tick({ run: { user }, unpromptedPending: true }))

    expect(mind.state.voice.runId).toBe(1)
    expect(mind.gate).toEqual(restoreGateMemory(promotionUrgeMemory(T0, randomSource(SEED)), user, ahead, T0))
    expect(mind.gate).toMatchObject({ ...user, ...pacing, lastOwnDayAtMs: T0, urge: 0, lastHardHoldAtMs: T0 })
    expect(mind.draws).toBe(1)
  })

  it('restores a new run from promotion alone without a slice or pacing', () => {
    const mind = script()
    mind.send(T0, tick({ unpromptedPending: true }))

    expect(mind.gate).toEqual(promotionUrgeMemory(T0, randomSource(SEED)))
    expect(mind.state.slow.pacing).toBeNull()
  })

  it('eases her in at a shown edge', () => {
    const mind = script()
    mind.send(T0, tick({ signals: { stageVisible: false } }))
    const hidden = mind.gate
    mind.send(T0 + 2 * SEC, tick())

    expect(mind.state.voice.stageShown).toBe(true)
    expect(mind.gate.lastHardHoldAtMs).toBe(visibilityRegainUrgeMemory(hidden, T0 + 2 * SEC).lastHardHoldAtMs)
  })

  it('skips the gate while a line or another unprompted turn is open', () => {
    const mind = script()
    mind.send(T0, tick({ unpromptedPending: true }, true))
    expect(mind.state.voice.lastGate).toBeNull()
    expect(mind.draws).toBe(1)

    speakOf(mind.send(T0 + SEC, tick({}, true)))
    const open = mind.state.voice
    expect(mind.send(T0 + 2 * SEC, tick({}, true))).toEqual([])
    expect(mind.state.voice).toEqual(open)
  })

  it('yields one speak with a reach-out line at a fire, and opens the line', () => {
    const mind = script()
    const intent = speakOf(mind.send(T0, tick({}, true)))

    expect(intent).toMatchObject({ channel: 'voice', cause: 1, line: { kind: 'reach-out', topicKey: 'own-day', reason: { kind: 'own-day', category: 'open' } } })
    expect(mind.state.voice.line).toEqual({ turnId: intent.turnId, kind: 'reach-out', runId: 1, speakBy: null, before: expect.objectContaining({ fires: [], pending: null }) })
    expect(mind.state.voice.lastGate).toMatchObject({ fire: true, reason: 'forced' })
    expect(mind.draws).toBe(6)
  })
})

describe('voice-outcome', () => {
  it('restores the gate of before a refused fire, with its draws spent', () => {
    const mind = script()
    mind.send(T0, tick({ signals: { stageVisible: false } }))
    const before = mind.gate
    const { turnId } = speakOf(mind.send(T0 + SEC, tick({}, true)))
    mind.send(T0 + 2 * SEC, { kind: 'voice-outcome', turnId, outcome: 'refused' })

    expect(mind.state.voice.line).toBeNull()
    expect(mind.gate).toMatchObject({ lastFireAtMs: before.lastFireAtMs, fires: before.fires, pending: null, urge: before.urge, urgeThreshold: before.urgeThreshold })
    expect(mind.draws).toBe(6)
  })

  it('arms a double text after a spoken reach-out, which fires later', () => {
    const mind = script()
    const { turnId } = speakOf(mind.send(T0, tick({}, true)))
    expect(mind.gate.pending!.doubleTextRoll).toBeLessThan(DOUBLE_TEXT_PROBABILITY)
    mind.send(T0 + SEC, { kind: 'voice-outcome', turnId, outcome: 'spoken' })
    const { dueAtMs } = mind.gate.doubleText!

    expect(mind.state.voice.line).toBeNull()
    expect(mind.gate.unanswered).toBe(1)
    expect(speakOf(mind.send(dueAtMs, tick())).line).toMatchObject({ kind: 'reach-out', topicKey: 'own-day', reason: { category: 'double-text' } })
  })

  it('keeps a refused reach-out of an earlier run out of the restored gate, and closes its line', () => {
    const mind = script()
    const { turnId } = speakOf(mind.send(T0, tick({}, true)))
    // "Delete all data" starts run 2 while the line is on its way.
    mind.send(T0 + SEC, tick({ run: { id: 2 } }))
    const restored = mind.gate
    mind.send(T0 + 2 * SEC, { kind: 'voice-outcome', turnId, outcome: 'refused' })

    expect(mind.state.voice.line).toBeNull()
    expect(mind.gate).toEqual(restored)
  })

  it('starts the floor of the current run for a spoken reach-out of an earlier run', () => {
    const mind = script()
    const { turnId } = speakOf(mind.send(T0, tick({}, true)))
    mind.send(T0 + SEC, tick({ run: { id: 2 } }))
    mind.send(T0 + 2 * SEC, { kind: 'voice-outcome', turnId, outcome: 'spoken' })

    expect(mind.gate).toMatchObject({ lastFireAtMs: T0 + 2 * SEC, lastSpokenAtMs: T0 + 2 * SEC, unanswered: 0, pending: null })
  })

  it('starts the gate floor for a spoken touch line', () => {
    const mind = script()
    mind.send(T0, tick({ signals: { stageVisible: false } }))
    mind.send(T0 + SEC, { kind: 'voice-outcome', turnId: 'reaction:touch-1', outcome: 'spoken' })

    expect(mind.gate).toMatchObject({ lastFireAtMs: T0 + SEC, lastSpokenAtMs: T0 + SEC, unanswered: 0 })
    expect(mind.state.voice.reaction.lastLineAtMs).toBe(T0 + SEC)
    mind.send(T0 + SEC + FLOOR_MS / 2, tick())
    expect(mind.state.voice.lastGate).toMatchObject({ fire: false, reason: 'floor' })
  })
})

describe('user turns', () => {
  it('resets unanswered at a user turn', () => {
    const mind = script(SEED, { pacing })
    mind.send(T0, tick({ run: { user } }))
    mind.send(T0 + SEC, { kind: 'user-turn' })

    expect(mind.gate).toMatchObject({ unanswered: 0, awaitingSinceMs: null })
    expect(mind.gate.damp).not.toBeNull()
  })
})

function request(turnId: string, overrides: Parameters<typeof view>[0] = {}, fields: Partial<VoiceRequest> = {}): MindStimulus {
  return { kind: 'voice-request', request: { turnId, topicKey: 'notify:weather', topicText: 'Rain at five', supplement: null, timeoutMs: 30 * SEC, ...fields }, view: view(overrides) }
}

const kindsOf = (intents: readonly MindIntent[]) => intents.map(intent => intent.kind)

describe('voice-request', () => {
  it('speaks a widget line at once when nobody is busy, and opens the line with its deadline', () => {
    const mind = script()
    const intent = speakOf(mind.send(T0, request('spark:1', {}, { supplement: 'short' })))

    expect(intent).toMatchObject({ channel: 'voice', turnId: 'spark:1', line: { kind: 'widget', topicKey: 'notify:weather', topicText: 'Rain at five', supplement: 'short' } })
    expect(mind.state.voice.line).toEqual({ turnId: 'spark:1', kind: 'widget', runId: 1, before: null, speakBy: T0 + 30 * SEC - WIDGET_DEADLINE_MARGIN_MS })
    expect(mind.state.voice.requests).toEqual([])
  })

  it('ignores the gate settings and presence', () => {
    const mind = script()
    const away = { ...situation, presence: { state: 'away' as const, reason: null, sinceMs: T0 - MIN } }
    const settings = { enabled: false, chattiness: 0, dontDisturb: true, quietApps: ['*'], speakDuringGames: false }

    speakOf(mind.send(T0, request('spark:1', { situation: away, settings, signals: { stageVisible: false, desktopFresh: false, foregroundFresh: false } })))
  })

  const holds: Array<[string, Parameters<typeof view>[0]]> = [
    ['the user speaks', { signals: { userSpeaking: true } }],
    ['the user may speak', { signals: { userSpeaking: null } }],
    ['the user types', { signals: { userTyping: true } }],
    ['she speaks', { signals: { characterSpeaking: true } }],
    ['a turn generates', { signals: { generating: true } }],
    ['a send is queued', { signals: { queued: 1 } }],
    ['an unprompted turn is pending', { unpromptedPending: true }],
  ]
  it.each(holds)('defers while %s, and speaks at the first quiet tick', (_, busy) => {
    const mind = script()
    expect(mind.send(T0, request('spark:1', busy))).toEqual([])
    expect(mind.send(T0 + 2 * SEC, tick(busy))).toEqual([])
    expect(mind.state.voice.requests).toHaveLength(1)

    expect(speakOf(mind.send(T0 + 4 * SEC, tick())).line.kind).toBe('widget')
    expect(mind.state.voice.lastGate).toBeNull()
  })

  it('defers while a line is open, and serves requests oldest first', () => {
    const mind = script()
    mind.send(T0, request('spark:1'))
    expect(mind.send(T0 + SEC, request('spark:2'))).toEqual([])
    expect(mind.send(T0 + 2 * SEC, request('spark:3'))).toEqual([])
    mind.send(T0 + 3 * SEC, { kind: 'voice-outcome', turnId: 'spark:1', outcome: 'declined' })

    expect(mind.state.voice.line).toBeNull()
    expect(speakOf(mind.send(T0 + 4 * SEC, tick())).turnId).toBe('spark:2')
  })

  it('drops a request past its start wait', () => {
    const mind = script()
    mind.send(T0, request('spark:1', { signals: { characterSpeaking: true } }))
    const intents = mind.send(T0 + WIDGET_START_WAIT_MS, tick())

    expect(intents).toMatchObject([{ channel: 'voice', kind: 'drop', turnId: 'spark:1' }])
    expect(mind.state.voice.requests).toEqual([])
  })

  it('cancels a widget line not spoken by its deadline, and closes it', () => {
    const mind = script()
    mind.send(T0, request('spark:1', {}, { timeoutMs: 10 * SEC }))
    expect(mind.send(T0 + 8 * SEC, tick({ signals: { stageVisible: false } }))).toEqual([])
    const intents = mind.send(T0 + 9 * SEC, tick({ signals: { stageVisible: false } }))

    expect(intents).toMatchObject([{ channel: 'voice', kind: 'cancel', turnId: 'spark:1' }])
    expect(mind.state.voice.line).toBeNull()
  })

  it('keeps the gate off a waiting request and its topic', () => {
    const mind = script()
    mind.send(T0, request('spark:1', { signals: { characterSpeaking: true } }, { topicKey: 'own-day' }))
    const intents = mind.send(T0 + SEC, tick({ signals: { characterSpeaking: true } }, true))

    expect(intents).toEqual([])
    expect(mind.state.voice.lastGate).toBeNull()
    expect(kindsOf(mind.send(T0 + 2 * SEC, tick({}, true)))).toEqual(['cue', 'speak'])
    expect(mind.state.voice.line?.kind).toBe('widget')
  })

  it('starts the floor for a spoken widget line, which is no unanswered opening', () => {
    const mind = script()
    mind.send(T0, tick({ signals: { stageVisible: false } }))
    mind.send(T0 + SEC, request('spark:1'))
    mind.send(T0 + 2 * SEC, { kind: 'voice-outcome', turnId: 'spark:1', outcome: 'spoken' })

    expect(mind.state.voice.line).toBeNull()
    expect(mind.gate).toMatchObject({ lastFireAtMs: T0 + 2 * SEC, lastSpokenAtMs: T0 + 2 * SEC, unanswered: 0, pending: null })
  })

  it('restores a new run at a request, so its spoken line starts the floor of that run', () => {
    const mind = script()
    mind.send(T0, tick({ signals: { stageVisible: false } }))
    mind.send(T0 + SEC, request('spark:1', { run: { id: 2 } }))
    mind.send(T0 + 2 * SEC, { kind: 'voice-outcome', turnId: 'spark:1', outcome: 'spoken' })
    mind.send(T0 + 3 * SEC, tick({ run: { id: 2 }, signals: { stageVisible: false } }))

    expect(mind.state.voice.runId).toBe(2)
    expect(mind.gate).toMatchObject({ lastFireAtMs: T0 + 2 * SEC, lastSpokenAtMs: T0 + 2 * SEC })
  })

  it('names the earliest widget deadline as the wake time', () => {
    const mind = script()
    expect(nextVoiceWakeAt(mind.state.voice)).toBeNull()
    mind.send(T0, request('spark:1', {}, { timeoutMs: 30 * SEC }))
    mind.send(T0 + SEC, request('spark:2'))
    expect(nextVoiceWakeAt(mind.state.voice)).toBe(T0 + WIDGET_START_WAIT_MS + SEC)

    mind.send(T0 + 2 * SEC, request('spark:3', {}, { timeoutMs: 5 * SEC }))
    mind.send(T0 + 3 * SEC, { kind: 'voice-outcome', turnId: 'spark:1', outcome: 'declined' })
    mind.send(T0 + 4 * SEC, tick())
    // spark:2 now speaks with its own deadline; spark:3 waits for its start.
    expect(nextVoiceWakeAt(mind.state.voice)).toBe(T0 + 2 * SEC + WIDGET_START_WAIT_MS)
  })
})

it('continues identically after a JSON round trip of the state', () => {
  const mind = script()
  const { turnId } = speakOf(mind.send(T0, tick({}, true)))
  mind.send(T0 + SEC, { kind: 'voice-outcome', turnId, outcome: 'spoken' })
  mind.send(T0 + SEC, request('spark:1', { signals: { characterSpeaking: true } }))
  mind.send(T0 + SEC, request('spark:2'))
  const restored: MindState = JSON.parse(JSON.stringify(mind.state))
  const next = tick({}, true)

  expect(restored).toEqual(mind.state)
  expect(step(restored, [next], T0 + 2 * SEC, randomSource(1))).toEqual(step(mind.state, [next], T0 + 2 * SEC, randomSource(1)))
})

describe('cues', () => {
  const cuesOf = (intents: readonly MindIntent[]) => intents.flatMap(intent => intent.kind === 'cue' ? [intent.cue] : [])

  it('cues about-to-speak before a reach-out line, under the same cause', () => {
    const intents = script().send(T0, tick({}, true))

    expect(intents.map(intent => [intent.kind, intent.cause])).toEqual([['cue', 1], ['speak', 1]])
    expect(cuesOf(intents)).toEqual(['about-to-speak'])
  })

  it('cues about-to-speak before a widget line, under the same cause', () => {
    const intents = script().send(T0, request('spark:1'))

    expect(intents.map(intent => [intent.kind, intent.cause])).toEqual([['cue', 1], ['speak', 1]])
    expect(cuesOf(intents)).toEqual(['about-to-speak'])
  })

  it('cues let-go when she declines a reach-out or a widget line, and nothing for another outcome', () => {
    const reachOut = script()
    const { turnId } = speakOf(reachOut.send(T0, tick({}, true)))
    expect(cuesOf(reachOut.send(T0 + SEC, { kind: 'voice-outcome', turnId, outcome: 'declined' }))).toEqual(['let-go'])

    const widget = script()
    widget.send(T0, request('spark:1'))
    expect(cuesOf(widget.send(T0 + SEC, { kind: 'voice-outcome', turnId: 'spark:1', outcome: 'declined' }))).toEqual(['let-go'])

    const spoken = script()
    spoken.send(T0, request('spark:1'))
    expect(spoken.send(T0 + SEC, { kind: 'voice-outcome', turnId: 'spark:1', outcome: 'spoken' })).toEqual([])
  })

  it('cues nothing around a touch line', () => {
    // Every draw speaks the line that reaches its roll.
    const speaks: MindRandom = () => 0.1
    let state = naturalMindState()
    const send = (atMs: number, stimulus: MindStimulus) => {
      const answer = step(state, [stimulus], atMs, speaks)
      state = answer.state
      return answer.intents
    }
    const pokeTimesMs = [T0, T0 + SEC, T0 + 2 * SEC]
    const intents = pokeTimesMs.flatMap(atMs => send(atMs, {
      kind: 'touch',
      gesture: 'poke',
      region: 'head',
      point: { x: 0, y: 0 },
      settings: defaultExpressionPerformanceSettings,
      voice: { sessionId: 'chat-a', eventId: 'touch-1', pet: null, pokeTimesMs: pokeTimesMs.filter(at => at <= atMs), lastCharacterLineAtMs: null, held: null },
    }))
    const { turnId } = speakOf(intents)

    expect(cuesOf(intents)).toEqual([])
    expect(send(T0 + 3 * SEC, { kind: 'voice-outcome', turnId, outcome: 'declined' })).toEqual([])
  })
})

describe('slow state', () => {
  it('follows each gate change that alters her pacing, and keeps the object otherwise', () => {
    const mind = script()
    mind.send(T0, tick({ signals: { stageVisible: false } }))
    // A fresh gate holds no pacing, so a mind that never spoke keeps none.
    expect(mind.state.slow.pacing).toBeNull()

    const { turnId } = speakOf(mind.send(T0 + 2 * SEC, tick({}, true)))
    expect(mind.state.slow.pacing).toBeNull()
    mind.send(T0 + 3 * SEC, { kind: 'voice-outcome', turnId, outcome: 'spoken' })
    const spoken = mind.state.slow.pacing
    expect(spoken).toEqual({ lastSpokenAtMs: T0 + 3 * SEC, unanswered: 1, awaitingSinceMs: T0 + 3 * SEC, damp: null, lastOwnDayAtMs: T0 + 3 * SEC })

    // A held tick changes the gate memory but not her pacing.
    mind.send(T0 + 5 * SEC, tick())
    expect(mind.state.slow.pacing).toBe(spoken)

    mind.send(T0 + 6 * SEC, { kind: 'user-turn' })
    expect(mind.state.slow.pacing).not.toBe(spoken)
    expect(mind.state.slow.pacing).toMatchObject({ unanswered: 0, awaitingSinceMs: null, damp: { sinceMs: T0 + 6 * SEC } })
  })

  it('continues identically from a JSON round trip of a state with slow pacing', () => {
    const steps: Array<[number, MindStimulus]> = [
      [T0, tick({ run: { user } })],
      [T0 + MIN, { kind: 'user-turn' }],
      [T0 + 10 * MIN, tick({}, true)],
      [T0 + 10 * MIN + SEC, tick()],
    ]
    const direct = script(SEED, { pacing })
    const resumed = script(SEED, { pacing })
    for (const [atMs, stimulus] of steps.slice(0, 2)) {
      direct.send(atMs, stimulus)
      resumed.send(atMs, stimulus)
    }
    const restored: MindState = JSON.parse(JSON.stringify(resumed.state))
    expect(restored.slow.pacing).not.toBeNull()
    const random = randomSource(SEED)
    for (let draw = 0; draw < resumed.draws; draw++)
      random()

    let state = restored
    for (const [atMs, stimulus] of steps.slice(2)) {
      const answer = step(state, [stimulus], atMs, random)
      state = answer.state
      expect(answer.intents).toEqual(direct.send(atMs, stimulus))
    }
    expect(state).toEqual(direct.state)
  })
})
