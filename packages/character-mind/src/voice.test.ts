import type { GateSignals, SavedGateMemory, SituationState, UrgeGateMemory } from '@proj-airi/stage-shared/situation'

import type { MindIntent, MindRandom, MindState, MindStimulus, VoiceRequest, VoiceRun, VoiceView } from './types'

import { DOUBLE_TEXT_PROBABILITY, FLOOR_MS, HOUR_MS, initialSituationState, initialUrgeMemory, promotionUrgeMemory, randomSource, restoreSocialMemory, visibilityRegainUrgeMemory } from '@proj-airi/stage-shared/situation'
import { describe, expect, it } from 'vitest'

import { initialMindState, step } from './step'
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
    heldTopics: [],
    unpromptedPending: false,
    ...overrides,
    run: { id: 1, memory: null, saved: null, ...overrides.run },
    signals: { ...QUIET, ...overrides.signals },
  }
}

function tick(overrides: Parameters<typeof view>[0] = {}, forceTiming = false): MindStimulus {
  return { kind: 'voice-tick', view: view(overrides), forceTiming }
}

/** One mind fed in order from one seeded source that counts its draws. */
function script(seed = SEED) {
  const source = randomSource(seed)
  let draws = 0
  const random: MindRandom = () => {
    draws++
    return source()
  }
  let state = initialMindState()
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

const saved: SavedGateMemory = { lastFireAtMs: T0 - 30 * MIN, lastSpokenAtMs: T0 - 30 * MIN, unanswered: 2, awaitingSinceMs: T0 - 30 * MIN, damp: null, day: null, lastOwnDayAtMs: null }

describe('voice-tick', () => {
  it('restores a new run from the mirror without its pending fire', () => {
    const memory: UrgeGateMemory = { ...initialUrgeMemory, urge: 0.4, fires: [T0 - MIN], pending: { topicKey: 'own-day', firedAtMs: T0 - MIN, spokenAtMs: null, category: 'open', reasonKind: 'own-day', doubleTextRoll: 1, doubleTextOffsetMs: 0 } }
    const mind = script()
    // A pending unprompted turn skips the gate, so the memory stays as restored.
    mind.send(T0, tick({ run: { memory, saved }, unpromptedPending: true }))

    expect(mind.state.voice.runId).toBe(1)
    expect(mind.gate).toEqual({ ...memory, pending: null })
  })

  it('restores a new run from the saved slice over a promotion, and from promotion alone without one', () => {
    for (const slice of [saved, null]) {
      const mind = script()
      mind.send(T0, tick({ run: { saved: slice }, unpromptedPending: true }))
      const promoted = promotionUrgeMemory(T0, randomSource(SEED))

      expect(mind.gate).toEqual(slice ? restoreSocialMemory(promoted, slice, T0) : promoted)
      expect(mind.draws).toBe(1)
    }
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
    expect(mind.state.voice.line).toEqual({ turnId: intent.turnId, kind: 'reach-out', speakBy: null, before: expect.objectContaining({ fires: [], pending: null }) })
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

describe('user and external turns', () => {
  it('resets unanswered at a user turn', () => {
    const mind = script()
    mind.send(T0, tick({ run: { saved } }))
    mind.send(T0 + SEC, { kind: 'user-turn', atMs: T0 + SEC })

    expect(mind.gate).toMatchObject({ unanswered: 0, awaitingSinceMs: null })
    expect(mind.gate.damp).not.toBeNull()
  })

  it('starts the floor at external speech', () => {
    const mind = script()
    mind.send(T0, tick({ signals: { stageVisible: false } }))
    mind.send(T0 + SEC, { kind: 'external-speech', atMs: T0 + SEC })

    expect(mind.gate).toMatchObject({ lastFireAtMs: T0 + SEC, lastSpokenAtMs: T0 + SEC, unanswered: 0 })
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
    expect(mind.state.voice.line).toEqual({ turnId: 'spark:1', kind: 'widget', before: null, speakBy: T0 + 30 * SEC - WIDGET_DEADLINE_MARGIN_MS })
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
    expect(kindsOf(mind.send(T0 + 2 * SEC, tick({}, true)))).toEqual(['speak'])
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
