import type { GateSignals, SituationState, UserGateMemory } from '@proj-airi/stage-shared/situation'

import type { MindIntent, MindState, MindStimulus, NoticeRequest, VoiceView } from './types'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { FLOOR_MS, HOUR_MS, initialSituationState, initialUrgeMemory, SAFETY_CAP_PER_HOUR, userGateMemoryOf } from '@proj-airi/stage-shared/situation'
import { describe, expect, it } from 'vitest'

import { initialMindState, step } from './step'
import { naturalMindState } from './test/fixtures'
import { nextVoiceWakeAt, NOTICE_START_WAIT_MS } from './voice'

const T0 = 1_700_000_000_000
const quiet: GateSignals = { userSpeaking: false, userTyping: false, characterSpeaking: false, generating: false, queued: 0, desktopFresh: true, foregroundFresh: true, stageVisible: true }
const situation: SituationState = {
  ...initialSituationState,
  nowMs: T0,
  presence: { state: 'here', reason: null, sinceMs: T0 },
  busy: { state: 'accepts', atMs: T0 },
}
const target = { sessionId: 'session-1', characterId: 'character-a', generation: 1, ownerTurnId: 'owner-1', open: true }
const request: NoticeRequest = { ...target, turnId: 'notice-1', messageId: 'notice-1', source: 'host:task', acceptedAtMs: T0 }

function view(overrides: Partial<VoiceView> = {}): VoiceView {
  return {
    run: { id: 1, user: null },
    situation,
    threads: { threads: { threads: [] } },
    local: { dayKey: '2023-11-14', minuteOfDay: 16 * 60 },
    sessionId: target.sessionId,
    noticeTarget: target,
    signals: quiet,
    settings: { enabled: true, chattiness: 0.5, dontDisturb: false, quietApps: [], speakDuringGames: true },
    moodFactor: 1,
    unpromptedPending: false,
    ...overrides,
  }
}

function script(user: UserGateMemory | null = null, initial: MindState = initialMindState()) {
  let state = initial
  let draws = 0
  const random = () => {
    draws++
    return 0.1
  }
  const send = (nowMs: number, ...stimuli: MindStimulus[]) => {
    const answer = step(state, stimuli, nowMs, random)
    state = answer.state
    return answer.intents
  }
  send(T0, { kind: 'voice-tick', view: view({ run: { id: 1, user }, unpromptedPending: true }), forceTiming: false })
  return {
    send,
    get state() { return state },
    get draws() { return draws },
    offer: (overrides: Partial<VoiceView> = {}, notice = request) => send(T0, { kind: 'notice-request', request: notice, view: view(overrides) }),
    tick: (nowMs: number, overrides: Partial<VoiceView> = {}) => send(nowMs, { kind: 'voice-tick', view: view(overrides), forceTiming: false }),
  }
}

function line(intents: readonly MindIntent[]) {
  const speaks = intents.filter(intent => intent.kind === 'speak')
  expect(speaks).toHaveLength(1)
  return speaks[0]
}

describe('owner-result voice policy', () => {
  it('allows disabled reach-outs, zero chattiness, and unanswered openings without a draw or undeclared cue', () => {
    const initial = initialMindState({ pacing: { lastSpokenAtMs: T0 - HOUR_MS, unanswered: 2, awaitingSinceMs: T0 - HOUR_MS, damp: null, lastOwnDayAtMs: null } })
    const mind = script(null, initial)
    const draws = mind.draws
    const intents = mind.offer({ settings: { ...view().settings, enabled: false, chattiness: 0 } })
    expect(line(intents).line.kind).toBe('notice')
    expect(intents.every(intent => intent.channel === 'voice')).toBe(true)
    expect(mind.draws).toBe(draws)
    mind.send(T0 + 1, { kind: 'voice-outcome', turnId: request.turnId, outcome: 'spoken' })
    expect(mind.state.voice.gate?.unanswered).toBe(2)
    expect(mind.state.voice.gate?.fires).toEqual([T0 + 1])
    expect(mind.state.voice.gate?.lastFireAtMs).toBe(T0 + 1)
    mind.send(T0 + 2, { kind: 'voice-outcome', turnId: request.turnId, outcome: 'spoken' })
    expect(mind.state.voice.gate?.fires).toEqual([T0 + 1])
  })

  const holds: Array<[string, Partial<VoiceView>]> = [
    ['do-not-disturb', { settings: { ...view().settings, dontDisturb: true } }],
    ['stage-hidden', { signals: { ...quiet, stageVisible: false } }],
    ['away', { situation: { ...situation, presence: { state: 'away', reason: 'locked', sinceMs: T0 } } }],
    ['unknown-presence', { situation: { ...situation, presence: { state: 'unknown', reason: null, sinceMs: T0 } } }],
    ['desktop-stale', { signals: { ...quiet, desktopFresh: false } }],
    ['foreground-stale', { signals: { ...quiet, foregroundFresh: false } }],
    ['user-speaking', { signals: { ...quiet, userSpeaking: true } }],
    ['unknown-speaking', { signals: { ...quiet, userSpeaking: null } }],
    ['draft', { signals: { ...quiet, userTyping: true } }],
    ['character-speaking', { signals: { ...quiet, characterSpeaking: true } }],
    ['generating', { signals: { ...quiet, generating: true } }],
    ['queued', { signals: { ...quiet, queued: 1 } }],
    ['unprompted-pending', { unpromptedPending: true }],
    ...(['busy', 'fullscreen', 'presentation', 'quiet', 'unknown'] as const).map(state => [`busy-${state}`, { situation: { ...situation, busy: { state, atMs: T0 } } }] as [string, Partial<VoiceView>]),
    ['quiet-app', { settings: { ...view().settings, quietApps: ['editor'] }, situation: { ...situation, activity: { appId: 'editor', label: 'Editor', category: 'editor', title: null, sinceMs: T0 } } }],
    ['call', { situation: { ...situation, activity: { appId: 'call', label: 'Call', category: 'call', title: null, sinceMs: T0 } } }],
    ['game', { settings: { ...view().settings, speakDuringGames: false }, situation: { ...situation, activity: { appId: 'game', label: 'Game', category: 'game', title: null, sinceMs: T0 } } }],
  ]

  it.each(holds)('holds a notice during %s without spending a draw', (_name, heldView) => {
    const mind = script()
    const draws = mind.draws
    expect(mind.offer(heldView)).toEqual([])
    expect(mind.state.voice.notices).toHaveLength(1)
    expect(mind.draws).toBe(draws)
    expect(nextVoiceWakeAt(mind.state.voice)).toBe(T0 + NOTICE_START_WAIT_MS)
  })

  it('opens at the exact floor boundary and shares the cap with ordinary attempts', () => {
    const mind = script({ lastFireAtMs: T0, fires: [], day: null })
    expect(mind.offer()).toEqual([])
    expect(mind.tick(T0 + FLOOR_MS - 1).some(intent => intent.kind === 'speak')).toBe(false)
    expect(line(mind.tick(T0 + FLOOR_MS)).line.kind).toBe('notice')
    const capped = script({ lastFireAtMs: null, fires: Array.from<number>({ length: SAFETY_CAP_PER_HOUR }).fill(T0 - HOUR_MS + 100), day: null })
    expect(capped.offer()).toEqual([])
    expect(capped.tick(T0 + 99).some(intent => intent.kind === 'speak')).toBe(false)
    expect(line(capped.tick(T0 + 100)).line.kind).toBe('notice')
  })

  it.each(['declined', 'cancelled', 'failed', 'refused'] as const)('charges nothing for a %s notice', (outcome) => {
    const mind = script()
    mind.offer()
    mind.send(T0 + 1, { kind: 'voice-outcome', turnId: request.turnId, outcome })
    expect(mind.state.voice.line).toBeNull()
    expect(mind.state.voice.gate?.fires).toEqual([])
    expect(mind.state.voice.gate?.lastFireAtMs).toBeNull()
    expect(mind.state.voice.gate?.unanswered).toBe(0)
  })

  it('keeps the spoken notice floor across character switches and normalizes a backward clock', () => {
    const first = script()
    first.offer()
    first.send(T0 + 10, { kind: 'voice-outcome', turnId: request.turnId, outcome: 'spoken' })
    const next = script(userGateMemoryOf(first.state.voice.gate!))
    const otherTarget = { ...target, characterId: 'character-b' }
    expect(next.offer({ noticeTarget: otherTarget }, { ...request, characterId: otherTarget.characterId })).toEqual([])
    expect(next.state.voice.gate?.lastFireAtMs).toBe(T0)
    expect(next.state.voice.gate?.fires).toEqual([T0])
  })

  it.each([
    { ...target, sessionId: 'session-2' },
    { ...target, characterId: 'character-b' },
    { ...target, generation: 2 },
    { ...target, ownerTurnId: 'owner-2' },
    { ...target, open: false },
    null,
  ])('drops a pending result when its target changes to %j', (noticeTarget) => {
    const mind = script()
    mind.offer({ signals: { ...quiet, userTyping: true } })
    expect(mind.tick(T0 + 1, { noticeTarget }).filter(intent => intent.kind === 'drop')).toMatchObject([{ turnId: request.turnId }])
    expect(mind.state.voice.notices).toEqual([])
  })

  it('drops at five minutes even while busy and never speaks the expired result later', () => {
    const mind = script()
    mind.offer({ signals: { ...quiet, userTyping: true } })
    expect(mind.tick(T0 + NOTICE_START_WAIT_MS, { signals: { ...quiet, userTyping: true } }).filter(intent => intent.kind === 'drop')).toHaveLength(1)
    expect(mind.state.voice.notices).toEqual([])
    expect(mind.tick(T0 + NOTICE_START_WAIT_MS + 1).some(intent => intent.kind === 'speak' && intent.line.kind === 'notice')).toBe(false)
  })

  it('cancels an admitted result on a newer owner turn and ignores its late completion', () => {
    const mind = script()
    mind.offer()
    expect(mind.send(T0 + 1, { kind: 'user-turn' }).filter(intent => intent.kind === 'cancel')).toMatchObject([{ turnId: request.turnId }])
    mind.send(T0 + 2, { kind: 'voice-outcome', turnId: request.turnId, outcome: 'spoken' })
    expect(mind.state.voice.gate?.fires).toEqual([])
  })

  it('serves waiting widgets, then urgent events, then the oldest eligible notice', () => {
    const mind = script()
    const heldView = view({ signals: { ...quiet, userTyping: true } })
    mind.send(T0, { kind: 'voice-request', request: { turnId: 'widget', topicKey: 'widget-topic', topicText: 'A widget', supplement: null, timeoutMs: 30_000 }, view: heldView })
    mind.offer(heldView, { ...request, turnId: 'notice-2', messageId: 'notice-2', acceptedAtMs: T0 + 1 })
    mind.offer(heldView)
    const urgent: SituationState = { ...situation, events: [{ id: 'plugin-1', kind: 'notify', topicKey: 'plugin-1', text: 'An immediate event', atMs: T0, salience: 1, halfLifeMs: HOUR_MS, tier: 0, origin: 'world', shownAtMs: null, addressedAtMs: null, notify: { urgency: 'immediate', provenance: { kind: 'plugin' } } }] }
    expect(line(mind.tick(T0 + 2, { situation: urgent })).line.kind).toBe('widget')
    mind.send(T0 + 3, { kind: 'voice-outcome', turnId: 'widget', outcome: 'declined' })
    const urgentLine = line(mind.tick(T0 + 4, { situation: urgent }))
    expect(urgentLine.line.kind).toBe('reach-out')
    mind.send(T0 + 5, { kind: 'voice-outcome', turnId: urgentLine.turnId, outcome: 'declined' })
    expect(line(mind.tick(T0 + 4 + FLOOR_MS)).turnId).toBe('notice-1')
    expect(mind.state.voice.notices.map(entry => entry.request.turnId)).toEqual(['notice-2'])
  })

  it('does not accrue or draw twice when an ineligible notice arrives before an ordinary tick', () => {
    const initial = initialMindState()
    initial.voice = { ...initial.voice, gate: { ...initialUrgeMemory, urge: 100, urgeThreshold: 1, lastEvalAtMs: T0 }, runId: 1, stageShown: true }
    const baseline = script(null, initial)
    const withNotice = script(null, initial)
    withNotice.offer({ noticeTarget: null })
    baseline.tick(T0 + 1000)
    withNotice.tick(T0 + 1000)
    expect(withNotice.state.voice.gate).toEqual(baseline.state.voice.gate)
    expect(withNotice.draws).toBe(baseline.draws)
  })

  it('keeps an admitted notice slot when a simultaneous eligible Natural poke arrives', () => {
    const mind = script(null, naturalMindState())
    mind.offer()
    const draws = mind.draws
    const intents = mind.send(T0 + 1, {
      kind: 'touch',
      gesture: 'poke',
      region: 'head',
      point: { x: 0, y: 0 },
      settings: defaultExpressionPerformanceSettings,
      voice: { sessionId: target.sessionId, eventId: 'touch', pet: null, pokeTimesMs: [T0 - 2, T0 - 1, T0], lastCharacterLineAtMs: null, held: null },
    })
    expect(intents.some(intent => intent.kind === 'speak')).toBe(false)
    expect(intents.some(intent => intent.kind === 'touch-reaction')).toBe(true)
    expect(mind.state.voice.line?.kind).toBe('notice')
    expect(mind.draws).toBe(draws)
  })
})
