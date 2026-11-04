import type { ChatHistoryItem, ChatHookRegistry, ChatStreamEventContext } from '@proj-airi/core-agent'
import type { GenerationProvider } from '@proj-airi/provider-inference'
import type { SituationState, TouchObservation, UrgeGateMemory, UrgeGatePending } from '@proj-airi/stage-shared/situation'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { SituationChatControls } from '../situation'

import { createChatHooks } from '@proj-airi/core-agent'
import { DEFAULT_CHARACTER_PROFILE, initialCharacterState, readCharacter } from '@proj-airi/stage-shared/character-state'
import { initialSituationState, initialUrgeMemory } from '@proj-airi/stage-shared/situation'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import { characterStateRepo } from '../../database/repos/character-state.repo'
import { memoryRepo } from '../../database/repos/memory.repo'
import { CHARACTER_STATE_SAVE_DEBOUNCE_MS, characterStateContext, useCharacterStateStore } from '../character-state'
import { useSituationObservabilityStore } from '../devtools/situation-observability'
import { useSituationStore } from '../situation'
import { EXCHANGE_QUIET_MS } from '../situation/sensors/exchange'
import { bridgeSituationToCharacter, REACH_OUT_UNANSWERED_AFTER_MS } from './situation-bridge'

vi.mock('../../database/repos/character-state.repo')
vi.mock('../../database/repos/memory.repo')

// The character state reads only the active card id and the cards (for their profiles) from the card store, whose real
// setup needs an i18n application context.
vi.mock('../modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  return {
    useAiriCardStore: defineStore('airi-card', {
      state: () => ({ activeCardId: 'default', cards: new Map<string, unknown>() }),
    }),
  }
})

// 8 pm local time: outside the ritual windows, away from the 04:00 rollover.
const T0 = new Date(2026, 9, 20, 20, 0, 0).getTime()
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
/** The gate seed of the situation tests: no ordinary fire comes unless a test forces one. */
const SEED = 497396
const profile = DEFAULT_CHARACTER_PROFILE

/** The leader's inner state lives in localStorage, which the Node project does not provide. */
class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

/** A synced runtime that leads, reporting its role on subscribe like the plugin. */
function leaderRuntime(): SyncedPiniaRuntime {
  return {
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
    isLeader: () => true,
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      listener(true)
      return () => {}
    }),
    participantId: 'situation-bridge-test',
    plugin: vi.fn(),
  }
}

const extractionProvider: GenerationProvider = {
  generation() {
    throw new Error('The fake stream sends no request')
  },
}

/** Quiet fake chat controls whose unprompted turns are spoken and whose extraction answers `state.answer`. */
function createChatControls() {
  const state: { messages: ChatHistoryItem[], answer: string, release: Promise<void> } = { messages: [], answer: '{"threads":[],"events":[]}', release: Promise.resolve() }
  const submitUnprompted = vi.fn(async () => ({ status: 'spoken' as const, text: 'Still at it?' }))
  const controls: SituationChatControls = {
    sending: () => false,
    pendingQueuedSendCount: () => 0,
    unpromptedPending: () => false,
    activeSessionId: () => 'session-1',
    submitUnprompted,
    submitReaction: async () => ({ status: 'spoken', text: 'Hey!' }),
    sessionMessages: () => state.messages,
    extractionSelection: async () => ({ provider: extractionProvider, model: 'chat-model', characterName: 'Airi' }),
    stream: async (_model, _provider, _conversation, options) => {
      await state.release
      await options?.onStreamEvent?.({ type: 'text-delta', text: state.answer })
    },
  }
  return { state, controls, submitUnprompted }
}

/** Emits the hooks of one finished user turn and her reply, as the chat runtime does. */
async function userTurn(hooks: ChatHookRegistry, turnId: string) {
  const context: ChatStreamEventContext = { sessionId: 'session-1', turnId, message: { role: 'user', content: 'hi', createdAt: Date.now(), id: turnId }, contexts: {}, composedMessage: [] }
  const output = { role: 'assistant' as const, content: 'Hi!', slices: [], tool_results: [] }
  await hooks.emitBeforeSendHooks('hi', context)
  await hooks.emitAssistantMessageHooks(output, 'Hi!', context)
  await hooks.emitChatTurnCompleteHooks({ output, outputText: 'Hi!', toolCalls: [] }, context)
}

function said(role: 'user' | 'assistant', id: string, content: string, createdAt = Date.now()): ChatHistoryItem {
  return role === 'user'
    ? { role, content, createdAt, id }
    : { role, content, slices: [], tool_results: [], createdAt, id }
}

function pet(atMs: number, region: 'head' | 'body' = 'head'): TouchObservation {
  return { kind: 'touch', gesture: 'pet', region, atMs, durationMs: 4_000 }
}

function poke(atMs: number): TouchObservation {
  return { kind: 'touch', gesture: 'poke', region: 'head', atMs }
}

/** Both stores leading in one window. `gate` runs the urge gate and thread extraction, as in the desktop app. */
async function startLeader(options: { gate?: boolean } = {}) {
  const runtime = leaderRuntime()
  const characterState = useCharacterStateStore()
  characterState.initialize(runtime)
  const situation = useSituationStore()
  const hooks = createChatHooks()
  const chat = createChatControls()
  if (options.gate) {
    const desktop = useDesktopActivityStore()
    const foreground = useForegroundWindowStore()
    const keepFresh = () => {
      desktop.setSnapshot({ idleSeconds: 0, locked: false, suspendedAtMs: null, resumedAtMs: null, unlockedAtMs: null, systemAudioLevel: null, screenChange: null, sampledAtMs: Date.now() })
      foreground.setSample({ exePath: 'C:\\Windows\\notepad.exe', exeName: 'notepad.exe', title: 'notes.txt - Notepad', pid: 7, ownProcess: false, busy: 'accepts', sampledAtMs: Date.now() })
    }
    keepFresh()
    setInterval(keepFresh, 1_000)
    situation.setStageVisible(true)
    situation.setHostCapabilities({ unprompted: true })
  }
  situation.observeChat(hooks, chat.controls)
  situation.initialize(runtime, { seedSource: () => SEED })
  await characterState.ready()
  return { characterState, situation, hooks, chat }
}

/** The leader's record once the events queued so far are applied. */
async function recordOf(characterState: ReturnType<typeof useCharacterStateStore>) {
  await characterState.ready()
  const record = characterState.leaderRecord
  if (!record)
    throw new Error('The character state has no record')
  return record
}

async function appliedIds(characterState: ReturnType<typeof useCharacterStateStore>) {
  return (await recordOf(characterState)).appliedEvents.recent.map(entry => entry.id)
}

/** Resolves with the status of the next thread extraction that settles. */
function nextExtraction() {
  const observability = useSituationObservabilityStore()
  const record = observability.recordExtraction
  return new Promise<string>((resolve) => {
    vi.spyOn(observability, 'recordExtraction').mockImplementationOnce((entry) => {
      record(entry)
      resolve(entry.status)
    })
  })
}

/** Ends the open exchange and resolves with the status of its extraction. */
async function endExchange() {
  const settled = nextExtraction()
  await vi.advanceTimersByTimeAsync(EXCHANGE_QUIET_MS + 1_000)
  return await settled
}

describe('bridgeSituationToCharacter', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ now: T0 })
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', new MemoryStorage())
    await characterStateRepo.clear()
    await memoryRepo.clear()
  })

  afterEach(() => {
    useSituationStore().dispose()
    useCharacterStateStore().dispose()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('raises valence for a pet, counts one unwelcome touch per poke burst, and ignores plain and unknown touches', async () => {
    const { characterState, situation } = await startLeader()
    const before = characterState.reading!.mood.valence

    situation.ingest(pet(Date.now()))
    const record = await recordOf(characterState)
    expect(record.mood.contributions.map(contribution => contribution.source)).toEqual(['touch'])
    expect(characterState.reading!.mood.valence).toBeGreaterThan(before)

    const ingestAt = (observation: TouchObservation) => {
      vi.setSystemTime(observation.atMs)
      situation.ingest(observation)
    }
    // A body pet makes no situation event, and an unknown gesture is dropped by the reducer.
    ingestAt(pet(T0 + 1_000, 'body'))
    // A stage window reports touches over the speech bus, so a malformed one arrives as parsed JSON.
    const tickle: TouchObservation = JSON.parse(`{"kind":"touch","gesture":"tickle","region":"head","atMs":${T0 + 2_000}}`)
    ingestAt(tickle)
    // Pokes 1 and 2 are plain; poke 3 starts the burst; poke 4 continues it.
    for (const offset of [3_000, 4_000, 5_000, 6_000])
      ingestAt(poke(T0 + offset))

    const touches = (await recordOf(characterState)).mood.contributions.filter(contribution => contribution.source === 'touch')
    expect(touches.map(contribution => Math.sign(contribution.delta.valence))).toEqual([1, -1])
    expect(await appliedIds(characterState)).toEqual([`touch:touch@${T0}`, `touch:touch@${T0 + 5_000}`])
  })

  it('lowers valence once for a reach-out left unanswered for 90 min while the gate ticks, then counts the late reply', async () => {
    const { characterState, situation, hooks, chat } = await startLeader({ gate: true })
    expect(await useSituationObservabilityStore().evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: true } })
    await vi.advanceTimersByTimeAsync(1_000)
    const spokenAtMs = T0
    // A hidden stage holds the gate, so the only reach-out is the forced one while the gate keeps ticking.
    situation.setStageVisible(false)

    await vi.advanceTimersByTimeAsync(REACH_OUT_UNANSWERED_AFTER_MS - 2_000)
    expect(await appliedIds(characterState)).not.toContain(`reach-out-unanswered:${spokenAtMs}`)

    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS)
    const record = await recordOf(characterState)
    const unanswered = record.mood.contributions.filter(contribution => contribution.source === 'reach-out-unanswered')
    expect(unanswered).toHaveLength(1)
    expect(unanswered[0]).toMatchObject({ id: `reach-out-unanswered:${spokenAtMs}`, atMs: spokenAtMs + REACH_OUT_UNANSWERED_AFTER_MS, halfLifeMs: 3 * HOUR_MS })
    expect(characterState.reading!.mood.valence).toBeLessThan(characterState.reading!.temperament.valence)
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()

    await userTurn(hooks, 'reply-1')
    expect(await appliedIds(characterState)).toEqual(expect.arrayContaining([`late-reply:${spokenAtMs}`, `reach-out-reply:${spokenAtMs}`]))
  })

  it('weighs the second and later unanswered reach-outs alike, and treats urgent lines as no reach-out', async () => {
    const characterState = useCharacterStateStore()
    characterState.initialize(leaderRuntime())
    await characterState.ready()
    const situation = shallowRef<SituationState>(initialSituationState)
    let gate: UrgeGateMemory = initialUrgeMemory
    const bridge = bridgeSituationToCharacter({ situation: () => situation.value, gate: () => gate, extractedThrough: () => undefined, messages: () => [] })
    const tick = (atMs: number) => {
      vi.setSystemTime(atMs)
      situation.value = { ...situation.value, nowMs: atMs }
    }
    const spoken = (atMs: number, category: UrgeGatePending['category'], unanswered: number) => {
      const pending: UrgeGatePending = { topicKey: 'own-day', firedAtMs: atMs, spokenAtMs: atMs, category, reasonKind: 'own-day', doubleTextRoll: 1, doubleTextOffsetMs: 0 }
      gate = { ...gate, pending, lastSpokenAtMs: atMs, awaitingSinceMs: atMs, unanswered }
      tick(atMs)
    }

    const times = [T0, T0 + 2 * HOUR_MS, T0 + 4 * HOUR_MS]
    for (const [index, atMs] of times.entries()) {
      spoken(atMs, index === 0 ? 'open' : 'continuation', index + 1)
      tick(atMs + REACH_OUT_UNANSWERED_AFTER_MS)
    }
    spoken(T0 + 6 * HOUR_MS, 'urgent', 3)
    tick(T0 + 6 * HOUR_MS + REACH_OUT_UNANSWERED_AFTER_MS)

    const unanswered = (await recordOf(characterState)).mood.contributions.filter(contribution => contribution.source === 'reach-out-unanswered')
    expect(unanswered.map(contribution => [contribution.id, contribution.halfLifeMs])).toEqual(times.map((atMs, index) => [`reach-out-unanswered:${atMs}`, (index === 0 ? 3 : 6) * HOUR_MS]))
    bridge.stop()
  })

  it('counts a reply to a ritual reach-out within the reply window as reciprocated', async () => {
    const characterState = useCharacterStateStore()
    characterState.initialize(leaderRuntime())
    await characterState.ready()
    const situation = shallowRef<SituationState>(initialSituationState)
    const pending: UrgeGatePending = { topicKey: 'ritual:greeting', firedAtMs: T0, spokenAtMs: T0, category: 'ritual', reasonKind: 'ritual-greeting', doubleTextRoll: 1, doubleTextOffsetMs: 0 }
    const gate: UrgeGateMemory = { ...initialUrgeMemory, pending, lastSpokenAtMs: T0, awaitingSinceMs: T0, unanswered: 1 }
    const bridge = bridgeSituationToCharacter({ situation: () => situation.value, gate: () => gate, extractedThrough: () => undefined, messages: () => [] })
    situation.value = { ...situation.value, nowMs: T0 }

    const replyAtMs = T0 + 30 * MINUTE_MS
    vi.setSystemTime(replyAtMs)
    situation.value = { ...situation.value, nowMs: replyAtMs, conversation: { ...situation.value.conversation, lastUserAtMs: replyAtMs } }

    expect(await appliedIds(characterState)).toEqual([`reach-out-reply:${T0}`, `ritual-reciprocated:${T0}`, `user-turn:${replyAtMs}`])
    bridge.stop()
  })

  it('counts the third user turn of the logical day as its one first real exchange, and character speech as interaction', async () => {
    const { characterState, situation, hooks } = await startLeader()
    for (const turn of ['turn-1', 'turn-2', 'turn-3', 'turn-4']) {
      vi.advanceTimersByTime(MINUTE_MS)
      await userTurn(hooks, turn)
    }
    let record = await recordOf(characterState)
    expect(record.relationship.activeDays).toBe(1)
    expect(record.lastInteractionAtMs).toBe(Date.now())
    expect(record.appliedEvents.recent.filter(entry => entry.id.startsWith('character-spoke:'))).toHaveLength(4)

    // A reloaded window counts the day's turns again; its third turn reuses the day's first real exchange id.
    await vi.advanceTimersByTimeAsync(CHARACTER_STATE_SAVE_DEBOUNCE_MS)
    situation.dispose()
    characterState.dispose()
    setActivePinia(createPinia())
    const reloaded = await startLeader()
    for (const turn of ['turn-5', 'turn-6', 'turn-7']) {
      vi.advanceTimersByTime(MINUTE_MS)
      await userTurn(reloaded.hooks, turn)
    }
    record = await recordOf(reloaded.characterState)
    expect(record.relationship.activeDays).toBe(1)
    expect(record.appliedEvents.recent.filter(entry => entry.id.startsWith('user-turn:first-real:'))).toEqual([{ id: 'user-turn:first-real:2026-10-20', atMs: T0 + 3 * MINUTE_MS }])
  })

  it('applies a return with its away gap', async () => {
    const { characterState, situation } = await startLeader()
    situation.ingest({ kind: 'presence', state: 'away', atMs: T0 })
    const backAtMs = T0 + 3 * 24 * HOUR_MS
    vi.setSystemTime(backAtMs)
    situation.ingest({ kind: 'presence', state: 'here', atMs: backAtMs })

    const record = await recordOf(characterState)
    expect(record.appliedEvents.recent.map(entry => entry.id)).toEqual([`return:presence:return@${backAtMs}`])
    expect(record.mood.contributions).toEqual([expect.objectContaining({ source: 'return', atMs: backAtMs })])
  })

  it('feeds extraction events once: a disclosure raises familiarity, a milestone writes one memory, and a replay changes nothing', async () => {
    const { characterState, situation, hooks, chat } = await startLeader({ gate: true })
    const familiarity = characterState.reading!.levels.familiarity
    chat.state.messages = [said('user', 'user-1', 'I sang for the first time in front of anyone.'), said('assistant', 'assistant-1', 'I loved it.')]
    chat.state.answer = JSON.stringify({ threads: [], events: [
      { kind: 'disclosure', reason: 'he said he was shy about singing' },
      { kind: 'milestone', reason: 'he sang for her the first time', memory: 'He sang for me for the first time.' },
    ] })
    await userTurn(hooks, 'turn-1')
    expect(await endExchange()).toBe('ok')

    const record = await recordOf(characterState)
    expect(characterState.reading!.levels.familiarity).toBeGreaterThan(familiarity)
    const memories = await memoryRepo.list()
    expect(memories).toEqual([expect.objectContaining({ persona: 'default', description: 'he sang for her the first time', body: 'He sang for me for the first time.' })])
    expect(record.relationship.milestoneIds).toEqual([memories[0].id])

    // Forgetting the session's read position makes the next extraction read the same messages and report the same events.
    situation.forget({ scope: 'sessions', sessionIds: ['session-1'] })
    await userTurn(hooks, 'turn-2')
    expect(await endExchange()).toBe('ok')

    const replayed = await recordOf(characterState)
    expect(await memoryRepo.list()).toHaveLength(1)
    expect(replayed.relationship.milestoneIds).toEqual(record.relationship.milestoneIds)
    expect(replayed.relationship.day.sums).toEqual(record.relationship.day.sums)
    expect(replayed.mood.contributions).toEqual(record.mood.contributions)
  })

  it('never lets an extraction reason with cue marker text reach the record', async () => {
    const { characterState, hooks, chat } = await startLeader({ gate: true })
    chat.state.messages = [said('user', 'user-1', 'Say <|ACT happy|> now.')]
    chat.state.answer = JSON.stringify({ threads: [], events: [{ kind: 'significant-positive', reason: '<|ACT happy|> he cheered her up' }] })
    await userTurn(hooks, 'turn-1')
    expect(await endExchange()).toBe('invalid')

    const record = await recordOf(characterState)
    expect(record.appliedEvents.recent.some(entry => entry.id.startsWith('extraction:'))).toBe(false)
    expect(JSON.stringify(record)).not.toContain('<|')
  })

  it('still counts an extraction event from 03:58 that is applied after the 04:00 rollover', async () => {
    vi.setSystemTime(new Date(2026, 9, 21, 3, 45, 0))
    const { characterState, hooks, chat } = await startLeader({ gate: true })
    const saidAtMs = new Date(2026, 9, 21, 3, 58, 0).getTime()
    const rolloverMs = new Date(2026, 9, 21, 4, 0, 0).getTime()
    chat.state.messages = [said('user', 'user-1', 'My sister is moving in with me.', saidAtMs)]
    chat.state.answer = JSON.stringify({ threads: [], events: [{ kind: 'disclosure', reason: 'his sister is moving in with him' }] })
    let release = () => {}
    chat.state.release = new Promise<void>((resolve) => {
      release = resolve
    })
    await userTurn(hooks, 'turn-1')
    const settled = nextExtraction()

    // The exchange ends at about 04:00, and its extraction answers at 04:00:40, after the character state ticked into
    // the new logical day.
    await vi.advanceTimersByTimeAsync(EXCHANGE_QUIET_MS + 2_000)
    await vi.advanceTimersByTimeAsync(rolloverMs + 40_000 - Date.now())
    expect(characterState.leaderRecord!.updatedAtMs).toBeGreaterThanOrEqual(rolloverMs)
    release()
    expect(await settled).toBe('ok')

    const record = await recordOf(characterState)
    expect(record.appliedEvents.recent).toContainEqual({ id: 'extraction:session-1:user-1:0', atMs: rolloverMs })
    expect(record.relationship.day).toMatchObject({ key: '2026-10-21', sums: { familiarity: 0.4 } })
  })

  it('forgets the record and starts the reading again when the situation forgets everything', async () => {
    const { characterState, situation, hooks } = await startLeader()
    situation.ingest(pet(Date.now()))
    await userTurn(hooks, 'turn-1')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await characterStateRepo.load('default')).not.toBeNull()

    situation.forget({ scope: 'everything' })
    await characterState.ready()

    expect(await characterStateRepo.load('default')).toBeNull()
    const context = characterStateContext(Date.now())
    expect(characterState.reading).toEqual(readCharacter(initialCharacterState('default', profile, context), profile, null, context))
  })
})
