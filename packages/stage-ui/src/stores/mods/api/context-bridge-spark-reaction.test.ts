import type { ChatHookRegistry, ChatStreamEventContext } from '@proj-airi/core-agent'
import type { WebSocketEventOf } from '@proj-airi/server-sdk'
import type { DesktopActivitySnapshot } from '@proj-airi/stage-shared/performance-state'
import type { GateInput } from '@proj-airi/stage-shared/situation'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { ChatUnpromptedPayload, ChatUnpromptedResult } from '../../chat'

import { createChatHooks } from '@proj-airi/core-agent'
import { evaluateGate, initialGateMemory, notifyTopicKey } from '@proj-airi/stage-shared/situation'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { chatComposerActivityChangedEvent, getSpeechBusContext, speechInputUserSpeakingChangedEvent, voiceRequestTurns, voiceSnapshotChanged, voiceTurnsChanged } from '../../../services/speech/bus'
import { COMPOSER_INPUT_RECENT_MS, GATE_INTERVAL_MS, useSituationStore } from '../../situation'
import { ingestSparkNotify, notifyObservationFrom } from '../../situation/sensors/notify'
import { useContextBridgeStore } from './context-bridge'

type SparkNotifyEvent = WebSocketEventOf<'spark:notify'>

// The orchestrator ingests the notify into the situation and remembers its id by topic, as the real store does, and
// runs no agent here.
const sparkNotifyIds = new Map<string, string>()
const handleSparkNotify = vi.fn(async (event: SparkNotifyEvent, _control?: unknown) => {
  ingestSparkNotify(event)
  const observation = notifyObservationFrom(event, Date.now())
  sparkNotifyIds.set(notifyTopicKey(observation.sourceKey, observation.eventId), event.data.id)
  return undefined
})
const recordSparkNotifyReaction = vi.fn()
const submitUnprompted = vi.fn<(payload: ChatUnpromptedPayload) => Promise<ChatUnpromptedResult>>()

vi.mock('../../character', () => ({
  useCharacterOrchestratorStore: () => ({ handleSparkNotify, sparkNotifyIdOf: (topicKey: string) => sparkNotifyIds.get(topicKey) }),
  useCharacterStore: () => ({ recordSparkNotifyReaction }),
}))

vi.mock('../../chat', () => ({
  useChatStore: () => ({ submitUnprompted }),
}))

vi.mock('../../chat/session-store', () => ({
  useChatSessionStore: () => ({}),
}))

vi.mock('../../chat/stream-store', () => ({
  useChatStreamStore: () => ({}),
}))

vi.mock('../../devtools/context-observability', () => ({
  useContextObservabilityStore: () => ({
    recordLifecycle: vi.fn(),
  }),
}))

vi.mock('../../modules/consciousness', () => ({
  useConsciousnessStore: () => ({
    activeProvider: ref(undefined),
    activeModel: ref(undefined),
    getChatProviderInstance: vi.fn(async () => ({})),
  }),
}))

vi.mock('../../providers/provider', () => ({
  useProviderStore: () => ({}),
}))

vi.mock('./channel-server', () => ({
  useModsServerChannelStore: () => ({
    ensureConnected: vi.fn(async () => undefined),
    send: vi.fn(),
    onReconnected: vi.fn(() => () => undefined),
    onContextUpdate: vi.fn(() => () => undefined),
    onEvent: vi.fn(() => () => undefined),
  }),
}))

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)
const BUSY = 'Another unprompted turn is still pending'

function syncedRuntime(isLeader: boolean): SyncedPiniaRuntime {
  return {
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
    isLeader: () => isLeader,
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      listener(isLeader)
      return () => {}
    }),
    participantId: 'spark-reaction-test',
    plugin: vi.fn(),
  }
}

function desktopSample(): DesktopActivitySnapshot {
  return { idleSeconds: 0, locked: false, suspendedAtMs: null, resumedAtMs: null, unlockedAtMs: null, systemAudioLevel: null, screenChange: null, sampledAtMs: Date.now() }
}

/** A gate input in which only the situation decides: the user is present and quiet, and timing is skipped. */
function quietGateInput(situation: GateInput['situation']): GateInput {
  return {
    nowMs: Date.now(),
    situation,
    signals: { userSpeaking: false, userTyping: false, characterSpeaking: false, generating: false, queued: 0, desktopFresh: true, foregroundFresh: true, stageVisible: true },
    settings: { enabled: true, chattiness: 1, dontDisturb: false, quietApps: [], speakDuringGames: true },
    forceTiming: true,
  }
}

/** The hook context of the unprompted turn that `payload` starts, as the chat runtime builds it. */
function unpromptedContext(payload: ChatUnpromptedPayload): ChatStreamEventContext {
  const turnId = payload.messageId!
  return {
    sessionId: 'session-1',
    turnId,
    origin: 'unprompted',
    message: { role: 'user', content: `(A quiet moment. Nobody said anything. What is on your mind right now: ${payload.topicText})`, createdAt: Date.now(), id: turnId, origin: 'unprompted', trigger: { topicKey: payload.topicKey, text: payload.topicText, kind: payload.reason?.kind ?? 'notify' } },
    contexts: {},
    composedMessage: [],
  }
}

/** Emits the hooks the chat runtime emits for an unprompted turn that is spoken to the end. */
async function speakUnprompted(hooks: ChatHookRegistry, payload: ChatUnpromptedPayload, text: string) {
  const context = unpromptedContext(payload)
  const output = { role: 'assistant' as const, content: text, slices: [], tool_results: [] }
  await hooks.emitBeforeSendHooks(context.message.content as string, context)
  await hooks.emitTokenLiteralHooks(text, context)
  await hooks.emitAssistantMessageHooks(output, text, context)
  await hooks.emitChatTurnCompleteHooks({ output, outputText: text, toolCalls: [] }, context)
}

/** Emits the hooks the chat runtime emits for an unprompted turn that the model declines: only the stream end. */
async function declineUnprompted(hooks: ChatHookRegistry, payload: ChatUnpromptedPayload) {
  const context = unpromptedContext(payload)
  await hooks.emitBeforeSendHooks(context.message.content as string, context)
  await hooks.emitStreamEndHooks({ ...context, cueStats: { act: 0, recovered: 0, rejected: 0, origin: 'unprompted', declined: true } })
}

describe('widget spark reactions', () => {
  let hooks: ChatHookRegistry
  let unpromptedPending: boolean
  /** The voice turns the audio host reports; any open turn means she is still replying or speaking. */
  let speakingTurns: Array<{ sessionId: string, turnId: string }>
  let stopVoiceHost: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    setActivePinia(createPinia())
    handleSparkNotify.mockClear()
    sparkNotifyIds.clear()
    recordSparkNotifyReaction.mockClear()
    submitUnprompted.mockReset()
    unpromptedPending = false
    speakingTurns = []
    const bus = getSpeechBusContext()
    stopVoiceHost = bus.on(voiceRequestTurns, () => bus.emit(voiceTurnsChanged, speakingTurns))
  })

  afterEach(() => {
    stopVoiceHost()
    useSituationStore().dispose()
    vi.useRealTimers()
  })

  /**
   * A leader window whose chat runs unprompted turns through `submitUnprompted`. With `gate`, it also runs the
   * opportunity gate on a visible stage with fresh samples, so only the gate's own rules decide.
   */
  function startLeader(options: { gate?: boolean } = {}) {
    hooks = createChatHooks()
    const desktop = useDesktopActivityStore()
    const foreground = useForegroundWindowStore()
    const keepFresh = () => {
      desktop.setSnapshot(desktopSample())
      foreground.setSample({ exePath: 'C:\\Tools\\qa-board.exe', exeName: 'qa-board.exe', title: 'QA board', pid: 7, ownProcess: false, busy: 'accepts', sampledAtMs: Date.now() })
    }
    keepFresh()
    setInterval(keepFresh, 1_000)
    const situation = useSituationStore()
    situation.setStageVisible(true)
    if (options.gate)
      situation.setHostCapabilities({ unprompted: true })
    situation.observeChat(hooks, {
      sending: () => false,
      pendingQueuedSendCount: () => 0,
      unpromptedPending: () => unpromptedPending,
      submitUnprompted: payload => submitUnprompted(payload),
    })
    situation.initialize(syncedRuntime(true))
    const bridge = useContextBridgeStore()
    bridge.setSparkNotifyHostRole('main')
    return { situation, bridge }
  }

  /** The chat answers every unprompted turn with `text`, spoken through the runtime hooks. */
  function chatSpeaks(text: string) {
    submitUnprompted.mockImplementation(async (payload) => {
      unpromptedPending = true
      try {
        await speakUnprompted(hooks, payload, text)
        return { status: 'spoken', text }
      }
      finally {
        unpromptedPending = false
      }
    })
  }

  function notifyEvents(situation: ReturnType<typeof useSituationStore>) {
    return situation.state.events.filter(event => event.kind === 'notify')
  }

  it('answers with the spoken reply of a forced turn, and addresses the notify only once she speaks', async () => {
    const { situation, bridge } = startLeader()
    let addressedAtSubmit: number | null | undefined
    submitUnprompted.mockImplementation(async (payload) => {
      addressedAtSubmit = notifyEvents(situation)[0]?.addressedAtMs
      await speakUnprompted(hooks, payload, 'Oh, a QA widget!')
      return { status: 'spoken', text: 'Oh, a QA widget!' }
    })

    const reaction = await bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', note: 'from the chess board', fallbackResponseText: 'fallback' })

    expect(reaction).toBe('Oh, a QA widget!')
    const event = handleSparkNotify.mock.calls[0]![0]
    // A widget-shaped event: its delivery id and its protocol event id differ, and each names a different thing.
    expect(event.data.id).not.toBe(event.data.eventId)
    expect(submitUnprompted).toHaveBeenCalledOnce()
    const payload = submitUnprompted.mock.calls[0]![0]
    expect(payload).toMatchObject({ force: true, topicText: 'QA widget: from the chess board', messageId: `spark:${event.data.id}` })
    expect(payload.topicKey.endsWith(`:${event.data.eventId}`)).toBe(true)

    const notifies = notifyEvents(situation)
    expect(notifies).toHaveLength(1)
    expect(notifies[0].topicKey).toBe(payload.topicKey)
    expect(addressedAtSubmit).toBeNull()
    expect(notifies[0].addressedAtMs).toEqual(expect.any(Number))
    expect(situation.state.conversation.lastUnpromptedTopic).toBe('QA widget: from the chess board')
    const { decision } = evaluateGate(quietGateInput(situation.state), initialGateMemory)
    expect(decision).toMatchObject({ fire: false, reason: 'no-topic', trace: { candidate: null } })
    expect(recordSparkNotifyReaction.mock.calls).toEqual([[event.data.id, 'Oh, a QA widget!']])
  })

  it('addresses the notify of a declined reaction, so the gate never raises what she chose not to say', async () => {
    const { situation, bridge } = startLeader({ gate: true })
    submitUnprompted.mockImplementationOnce(async (payload) => {
      unpromptedPending = true
      try {
        await declineUnprompted(hooks, payload)
        return { status: 'declined' }
      }
      finally {
        unpromptedPending = false
      }
    })

    const reaction = await bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    // The notify is urgent, so an unaddressed one would fire at the next gate tick.
    await vi.advanceTimersByTimeAsync(3 * GATE_INTERVAL_MS)

    expect(reaction).toBe('fallback')
    expect(notifyEvents(situation)[0].addressedAtMs).toEqual(expect.any(Number))
    expect(submitUnprompted).toHaveBeenCalledOnce()
    expect(recordSparkNotifyReaction).not.toHaveBeenCalled()
  })

  it('keeps her last spoken remark when a later reaction is declined', async () => {
    const { situation, bridge } = startLeader()
    chatSpeaks('First thing.')
    await bridge.dispatchSparkNotifyReaction({ headline: 'QA first', fallbackResponseText: 'fallback' })
    submitUnprompted.mockImplementationOnce(async (payload) => {
      await declineUnprompted(hooks, payload)
      return { status: 'declined' }
    })

    await bridge.dispatchSparkNotifyReaction({ headline: 'QA declined', fallbackResponseText: 'fallback' })
    expect(situation.state.conversation.lastUnpromptedTopic).toBe('QA first')

    await bridge.dispatchSparkNotifyReaction({ headline: 'QA third', fallbackResponseText: 'fallback' })
    expect(situation.state.conversation.lastUnpromptedTopic).toBe('QA third')
  })

  it.each([
    ['cancelled', { status: 'cancelled' }],
    ['failed', { status: 'failed', error: 'provider down' }],
    ['busy', { status: 'failed', error: BUSY }],
  ] satisfies Array<[string, ChatUnpromptedResult]>)('returns the fallback and leaves the notify for the gate when the turn is %s', async (_label, result) => {
    const { situation, bridge } = startLeader()
    submitUnprompted.mockResolvedValue(result)

    const reaction = await bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })

    expect(reaction).toBe('fallback')
    const [notify] = notifyEvents(situation)
    expect(notify.addressedAtMs).toBeNull()
    expect(evaluateGate(quietGateInput(situation.state), initialGateMemory).decision.trace.candidate?.topicKey).toBe(notify.topicKey)
    expect(recordSparkNotifyReaction).not.toHaveBeenCalled()
  })

  it('names the widget topic as her last remark, not a gate topic that was declined before', async () => {
    const { situation, bridge } = startLeader()
    // A gate fire addressed an unlock, and its turn was declined: the unlock waits as the addressed topic.
    situation.ingest({ kind: 'wake', cause: 'unlock', atMs: Date.now() })
    situation.markAddressed('wake')
    chatSpeaks('Oh, a QA widget!')

    await bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })

    expect(situation.state.conversation.lastUnpromptedTopic).toBe('QA widget')
  })

  it('runs only the forced commands agent when the caller forces a spark command', async () => {
    const { situation, bridge } = startLeader()

    const reaction = await bridge.dispatchSparkNotifyReaction({ headline: 'Take cover', fallbackResponseText: 'fallback', forceSparkCommandResponse: true })

    expect(reaction).toBe('fallback')
    expect(handleSparkNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'spark:notify' }), expect.objectContaining({ forceSparkCommandResponse: true }))
    expect(submitUnprompted).not.toHaveBeenCalled()
    expect(notifyEvents(situation)).toHaveLength(1)
  })

  it('still answers when the commands-only agent run fails', async () => {
    const { bridge } = startLeader()
    handleSparkNotify.mockImplementationOnce(async (event) => {
      ingestSparkNotify(event)
      throw new Error('agent down')
    })
    chatSpeaks('Still here.')

    const reaction = await bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', destinations: ['character', 'plugin:qa-board'], fallbackResponseText: 'fallback' })

    expect(reaction).toBe('Still here.')
  })

  it('answers a request without a usable headline with its fallback and starts no turn', async () => {
    const { situation, bridge } = startLeader()
    chatSpeaks('unused')

    // Callers outside the widget schema can send anything over the bridge channel.
    const blank = await bridge.dispatchSparkNotifyReaction({ headline: '   ', fallbackResponseText: 'fallback' })
    const wrongType = await bridge.dispatchSparkNotifyReaction(JSON.parse('{"headline":42,"fallbackResponseText":"fallback"}'))

    expect([blank, wrongType]).toEqual(['fallback', 'fallback'])
    expect(submitUnprompted).not.toHaveBeenCalled()
    expect(notifyEvents(situation)).toEqual([])
  })

  it('starts the forced turn only after her current reply has finished speaking', async () => {
    const { bridge } = startLeader()
    chatSpeaks('After you.')
    speakingTurns = [{ sessionId: 'session-1', turnId: 'reply-to-user' }]

    const reaction = bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(submitUnprompted).not.toHaveBeenCalled()

    // The audio host reports that her reply drained.
    speakingTurns = []
    getSpeechBusContext().emit(voiceTurnsChanged, [])

    await expect(reaction).resolves.toBe('After you.')
    expect(submitUnprompted).toHaveBeenCalledOnce()
  })

  it('gives up with the fallback, and leaves the notify for the gate, when she keeps speaking past the wait', async () => {
    const { situation, bridge } = startLeader()
    chatSpeaks('unused')
    speakingTurns = [{ sessionId: 'session-1', turnId: 'long-reply' }]

    const reaction = bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    await vi.advanceTimersByTimeAsync(20_000)

    await expect(reaction).resolves.toBe('fallback')
    expect(submitUnprompted).not.toHaveBeenCalled()
    expect(notifyEvents(situation)[0].addressedAtMs).toBeNull()
  })

  it('submits at once when the user is neither speaking nor writing', async () => {
    const { bridge } = startLeader()
    let submittedAtMs: number | undefined
    submitUnprompted.mockImplementation(async (payload) => {
      submittedAtMs = Date.now()
      await speakUnprompted(hooks, payload, 'Right away.')
      return { status: 'spoken', text: 'Right away.' }
    })

    // No fake timer is advanced, so the reaction can only resolve if nothing waits on time.
    await expect(bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })).resolves.toBe('Right away.')
    expect(submittedAtMs).toBe(T0)
  })

  it('holds the forced turn while the user speaks into the microphone, and starts it once they stop', async () => {
    const { bridge } = startLeader()
    chatSpeaks('There you are.')
    const bus = getSpeechBusContext()
    bus.emit(speechInputUserSpeakingChangedEvent, { speaking: true })

    const reaction = bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(submitUnprompted).not.toHaveBeenCalled()

    bus.emit(speechInputUserSpeakingChangedEvent, { speaking: false })

    await expect(reaction).resolves.toBe('There you are.')
    expect(submitUnprompted).toHaveBeenCalledOnce()
  })

  it('holds the forced turn while speech-to-text finishes the user\'s message, and starts it once the input settles', async () => {
    const { bridge } = startLeader()
    chatSpeaks('Heard you.')
    const bus = getSpeechBusContext()
    const inputIn = (phase: 'capturing' | 'finalizing' | 'settled') => ({ connected: true, hostId: 'host-1', drafts: [], input: { requestId: 'mic', sessionId: 'session-1', phase, text: 'hello there', segments: [] } })
    bus.emit(voiceSnapshotChanged, inputIn('capturing'))
    bus.emit(speechInputUserSpeakingChangedEvent, { speaking: true })

    const reaction = bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    // The user stops speaking, in the order the voice host reports it. The host still transcribes, and only then
    // submits the user's message, which would cancel a reaction that already started speaking.
    bus.emit(voiceSnapshotChanged, inputIn('finalizing'))
    bus.emit(speechInputUserSpeakingChangedEvent, { speaking: false })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(submitUnprompted).not.toHaveBeenCalled()

    bus.emit(voiceSnapshotChanged, inputIn('settled'))

    await expect(reaction).resolves.toBe('Heard you.')
    expect(submitUnprompted).toHaveBeenCalledOnce()
  })

  it('gives up with the fallback, and leaves the notify for the gate, when an unsent draft outlasts the wait', async () => {
    const { situation, bridge } = startLeader()
    chatSpeaks('unused')
    // A composer with a draft reports it again every 5 s, as the real composer does.
    const reportDraft = () => getSpeechBusContext().emit(chatComposerActivityChangedEvent, { sourceId: 'chat-window', hasDraft: true, lastInputAtMs: T0 })
    reportDraft()
    const resend = setInterval(reportDraft, 5_000)

    const reaction = bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    await vi.advanceTimersByTimeAsync(20_000)
    clearInterval(resend)

    await expect(reaction).resolves.toBe('fallback')
    expect(submitUnprompted).not.toHaveBeenCalled()
    expect(notifyEvents(situation)[0].addressedAtMs).toBeNull()
  })

  it('starts the forced turn once the draft is cleared and the last input is no longer recent', async () => {
    const { bridge } = startLeader()
    chatSpeaks('Done typing?')
    const bus = getSpeechBusContext()
    bus.emit(chatComposerActivityChangedEvent, { sourceId: 'chat-window', hasDraft: true, lastInputAtMs: Date.now() })

    const reaction = bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(submitUnprompted).not.toHaveBeenCalled()

    // The user deletes the draft: the composer reports no draft, with the deletion as its last input.
    bus.emit(chatComposerActivityChangedEvent, { sourceId: 'chat-window', hasDraft: false, lastInputAtMs: Date.now() })
    await vi.advanceTimersByTimeAsync(COMPOSER_INPUT_RECENT_MS - 1)
    expect(submitUnprompted).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    await expect(reaction).resolves.toBe('Done typing?')
    expect(submitUnprompted).toHaveBeenCalledOnce()
  })

  it('lets a user send during the wait go first, and starts the forced turn only after her reply to it', async () => {
    const { bridge } = startLeader()
    chatSpeaks('Back to the widget.')
    const bus = getSpeechBusContext()
    bus.emit(chatComposerActivityChangedEvent, { sourceId: 'chat-window', hasDraft: true, lastInputAtMs: Date.now() })

    const reaction = bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    await vi.advanceTimersByTimeAsync(2_000)
    // The user sends: the composer clears its draft, and her reply to the user opens a voice turn.
    bus.emit(chatComposerActivityChangedEvent, { sourceId: 'chat-window', hasDraft: false, lastInputAtMs: Date.now() })
    speakingTurns = [{ sessionId: 'session-1', turnId: 'reply-to-user' }]
    bus.emit(voiceTurnsChanged, speakingTurns)

    // The user's input is no longer recent, but she is still answering them.
    await vi.advanceTimersByTimeAsync(COMPOSER_INPUT_RECENT_MS + 2_000)
    expect(submitUnprompted).not.toHaveBeenCalled()

    speakingTurns = []
    bus.emit(voiceTurnsChanged, [])

    await expect(reaction).resolves.toBe('Back to the widget.')
    expect(submitUnprompted).toHaveBeenCalledOnce()
  })

  it('holds a reaction that a follower window serves while a composer in another window has a draft', async () => {
    // Any main window may take a widget request, so a follower reads the user's input from the bus too.
    const situation = useSituationStore()
    situation.initialize(syncedRuntime(false))
    const bridge = useContextBridgeStore()
    bridge.setSparkNotifyHostRole('main')
    submitUnprompted.mockResolvedValue({ status: 'spoken', text: 'Hi from here.' })
    const bus = getSpeechBusContext()
    bus.emit(chatComposerActivityChangedEvent, { sourceId: 'chat-window', hasDraft: true, lastInputAtMs: Date.now() })

    const reaction = bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    await vi.advanceTimersByTimeAsync(4_000)
    expect(submitUnprompted).not.toHaveBeenCalled()

    bus.emit(chatComposerActivityChangedEvent, { sourceId: 'chat-window', hasDraft: false, lastInputAtMs: Date.now() })
    await vi.advanceTimersByTimeAsync(COMPOSER_INPUT_RECENT_MS)

    await expect(reaction).resolves.toBe('Hi from here.')
    expect(submitUnprompted).toHaveBeenCalledOnce()
  })

  it('starts a fresh turn for every request, so a repeated widget request never meets an earlier send key', async () => {
    const { bridge } = startLeader()
    chatSpeaks('Nice move.')

    const first = await bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    const second = await bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })

    expect([first, second]).toEqual(['Nice move.', 'Nice move.'])
    const [firstId, secondId] = submitUnprompted.mock.calls.map(([payload]) => payload.messageId)
    expect(firstId).toMatch(/^spark:/)
    expect(secondId).toMatch(/^spark:/)
    expect(secondId).not.toBe(firstId)
  })

  it('keeps the gate from raising the notify while the forced turn is on its way to the leader', async () => {
    const { situation, bridge } = startLeader({ gate: true })
    // The synced call reaches the leader's chat a few gate ticks late: until then nothing reports a pending turn.
    let land!: () => void
    submitUnprompted.mockImplementationOnce(async (payload) => {
      await new Promise<void>((resolve) => {
        land = resolve
      })
      unpromptedPending = true
      try {
        await speakUnprompted(hooks, payload, 'Oh, a QA widget!')
        return { status: 'spoken', text: 'Oh, a QA widget!' }
      }
      finally {
        unpromptedPending = false
      }
    })

    // An immediate notify is urgent, so the gate would raise it at once, past every timing guard.
    const reaction = bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    await vi.advanceTimersByTimeAsync(3 * GATE_INTERVAL_MS)
    expect(submitUnprompted).toHaveBeenCalledOnce()

    land()
    await expect(reaction).resolves.toBe('Oh, a QA widget!')
    await vi.advanceTimersByTimeAsync(3 * GATE_INTERVAL_MS)

    expect(submitUnprompted).toHaveBeenCalledOnce()
    expect(notifyEvents(situation)[0].addressedAtMs).toEqual(expect.any(Number))
  })

  /** A character-only notify whose delivery id and protocol event id differ, as the devtools simulator sends it. */
  function characterNotify(headline: string): SparkNotifyEvent {
    return {
      type: 'spark:notify',
      source: 'devtools',
      data: { id: `delivery-${headline}`, eventId: `event-${headline}`, kind: 'ping', urgency: 'immediate', headline, destinations: ['character'] },
    }
  }

  it('records one reaction with the spoken reply when a gate-fired turn speaks about a notify', async () => {
    startLeader({ gate: true })
    chatSpeaks(' Oh, a QA video! Enjoy. ')
    const event = characterNotify('QA video')

    await handleSparkNotify(event)
    await vi.advanceTimersByTimeAsync(3 * GATE_INTERVAL_MS)

    expect(submitUnprompted).toHaveBeenCalledOnce()
    expect(submitUnprompted.mock.calls[0]![0].topicKey).toBe(notifyTopicKey('devtools', event.data.eventId))
    expect(recordSparkNotifyReaction.mock.calls).toEqual([[event.data.id, 'Oh, a QA video! Enjoy.']])
  })

  it('records no reaction when a gate-fired turn about a notify is declined', async () => {
    startLeader({ gate: true })
    submitUnprompted.mockImplementation(async (payload) => {
      unpromptedPending = true
      try {
        await declineUnprompted(hooks, payload)
        return { status: 'declined' }
      }
      finally {
        unpromptedPending = false
      }
    })

    await handleSparkNotify(characterNotify('QA video'))
    await vi.advanceTimersByTimeAsync(3 * GATE_INTERVAL_MS)

    expect(submitUnprompted).toHaveBeenCalledOnce()
    expect(recordSparkNotifyReaction).not.toHaveBeenCalled()
  })

  it('records no reaction when a gate-fired turn speaks about a topic that is not a notify', async () => {
    const { situation } = startLeader({ gate: true })
    chatSpeaks('Welcome back.')
    // Promotion holds an ordinary topic for the minimum gap, 10 minutes at the default Chattiness.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000)

    situation.ingest({ kind: 'wake', cause: 'unlock', atMs: Date.now() })
    await vi.advanceTimersByTimeAsync(3 * GATE_INTERVAL_MS)

    expect(submitUnprompted).toHaveBeenCalledOnce()
    expect(recordSparkNotifyReaction).not.toHaveBeenCalled()
  })

  it('waits 30 s for the main window to answer a widget request', async () => {
    const bridge = useContextBridgeStore()
    bridge.setSparkNotifyHostRole('client')

    const reaction = bridge.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    const performance = bridge.dispatchSparkNotifyPerformance({
      headline: 'QA widget',
      fallbackResponseText: 'fallback',
      calls: [{ manifest: { name: 'plugin.action', prompt: 'Run it.' }, handler: vi.fn() }],
    })
    const settled: string[] = []
    void reaction.then(() => settled.push('reaction'))
    void performance.then(() => settled.push('performance'))

    await vi.advanceTimersByTimeAsync(29_999)
    expect(settled).toEqual([])
    await vi.advanceTimersByTimeAsync(1)

    await expect(reaction).resolves.toBe('fallback')
    await expect(performance).resolves.toEqual({ type: 'timeout', reaction: 'fallback' })
  })
})
