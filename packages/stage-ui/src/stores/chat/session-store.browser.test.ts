import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { CODE_BLOCK_SYSTEM_PROMPT, MATH_SYNTAX_SYSTEM_PROMPT } from '@proj-airi/stage-shared/stage-contract'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, watch } from 'vue'
import { createI18n } from 'vue-i18n'

import { chatSessionsRepo } from '../../database/repos/chat-sessions.repo'
import { useAiriCardStore } from '../modules/airi-card'

vi.mock('../../database/repos/chat-sessions.repo', () => ({
  chatSessionsRepo: {
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getIndex: vi.fn().mockResolvedValue(null),
    getSession: vi.fn().mockResolvedValue(null),
    saveIndex: vi.fn().mockResolvedValue(undefined),
    saveSession: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../libs/product-signals', () => ({
  captureAnalyticsEvent: vi.fn(),
  enableAnalytics: vi.fn(() => false),
  getAnalytics: vi.fn(),
  getAnalyticsPrivacyPolicyUrl: vi.fn(),
  isAnalyticsAvailableInBuild: vi.fn(() => false),
}))

const { useChatSessionStore } = await import('./session-store')

const syncedContexts: Array<{
  pinia: ReturnType<typeof createPinia>
  runtime: SyncedPiniaRuntime
  app: ReturnType<typeof createApp>
  container: HTMLDivElement
}> = []

function createSyncedContext(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({
    callTimeout: 1000,
    leadership,
    namespace,
  })
  pinia.use(runtime.plugin)
  const card = {
    name: 'Character',
    version: '1.0',
    extensions: { airi: { agents: {}, modules: {
      consciousness: { provider: '', model: '' },
      vision: { provider: '', model: '' },
      speech: { provider: '', model: '', voice_id: '' },
    } } },
  }
  localStorage.setItem('airi-cards', JSON.stringify([['default', card], ['background-character', card]]))
  const app = createApp(defineComponent({ setup() {
    useAiriCardStore()
    return () => h('div')
  } }))
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false }))
  const container = document.createElement('div')
  document.body.append(container)
  app.mount(container)
  syncedContexts.push({ pinia, runtime, app, container })
  return { pinia, runtime }
}

afterEach(() => {
  for (const context of syncedContexts.splice(0)) {
    context.app.unmount()
    context.container.remove()
    context.runtime.dispose()
    disposePinia(context.pinia)
  }
  localStorage.clear()
})

describe('chat session synchronization', () => {
  it('keeps a message that the leader commits while a follower reads the session', async () => {
    // ROOT CAUSE:
    //
    // Reading an empty session wrote it. The follower then proposed its session state without the committed message,
    // and the leader applied that proposal after the commit.
    //
    // The fix makes reads pure. Source: upstream moeru-ai/airi#3097.
    const namespace = `chat-read:${crypto.randomUUID()}`
    const leaderContext = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leaderContext.runtime.isLeader()).toBe(true))
    setActivePinia(leaderContext.pinia)
    const leader = useChatSessionStore()
    await leader.initialize()

    const followerContext = createSyncedContext(namespace, 'follower-only')
    setActivePinia(followerContext.pinia)
    const follower = useChatSessionStore()
    await vi.waitFor(() => expect(followerContext.runtime.getLeaderId()).toBe(leaderContext.runtime.participantId))
    await follower.initialize()
    const sessionId = await follower.createSession('default')
    // A session whose history is still empty, such as one known from the index before its first stored message.
    leader.sessionMessages[sessionId] = []
    await vi.waitFor(() => expect(follower.sessionMessages[sessionId]).toEqual([]))

    expect(follower.getSessionMessages(sessionId)).toEqual([])
    expect(follower.getSessionGeneration(sessionId)).toBe(leader.getSessionGeneration(sessionId))
    await follower.commitUserMessage(sessionId, { id: 'user-1', role: 'user', content: 'hello', createdAt: 1 })
    await follower.storeMessage(sessionId, { id: 'assistant-1', role: 'assistant', content: 'hi', slices: [], tool_results: [], createdAt: 2 })
    // A retried store replaces the message, so the history keeps one copy.
    await follower.storeMessage(sessionId, { id: 'assistant-1', role: 'assistant', content: 'hi there', slices: [], tool_results: [], createdAt: 2 })

    const expected = [
      { id: 'user-1', role: 'user', content: 'hello', createdAt: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'hi there', slices: [], tool_results: [], createdAt: 2 },
    ]
    // A leader-routed call from the follower arrives after any proposal that the follower sent before it,
    // so a stale proposal would already have reached the leader when this call resolves.
    await follower.loadSession(sessionId)
    await vi.waitFor(() => expect(follower.sessionMessages[sessionId]).toEqual(expected))
    expect(leader.sessionMessages[sessionId]).toEqual(expected)
  })

  it('routes concurrent follower wake requests to one character session without navigating either window', async () => {
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leader = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    setActivePinia(leader.pinia)
    const leaderStore = useChatSessionStore()
    await leaderStore.initialize()
    const foreground = leaderStore.activeSessionId
    const follower = createSyncedContext(namespace, 'follower-only')
    setActivePinia(follower.pinia)
    const followerStore = useChatSessionStore()
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
    await followerStore.initialize()
    const [first, second] = await Promise.all([
      followerStore.ensureCharacterSession('background-character'),
      followerStore.ensureCharacterSession('background-character'),
    ])
    expect(first).toBe(second)
    expect(leaderStore.sessionMetas[first]?.characterId).toBe('background-character')
    expect(leaderStore.activeSessionId).toBe(foreground)
    expect(followerStore.activeSessionId).toBe(foreground)
    await expect(followerStore.ensureCharacterSession('missing')).rejects.toThrow('unavailable')
  })

  it('resets a background session with the prompt of its own character', async () => {
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leader = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    setActivePinia(leader.pinia)
    const cards = useAiriCardStore()
    const background = cards.getCard('background-character')!
    cards.cards.set('background-character', { ...background, systemPrompt: 'Background character prompt' })
    const store = useChatSessionStore()
    await store.initialize()
    const sessionId = await store.ensureCharacterSession('background-character')

    store.cleanupMessages(sessionId)

    expect(cards.activeCardId).toBe('default')
    expect(store.getSessionMessages(sessionId)[0]?.content).toContain('Background character prompt')
    expect(store.getSessionSystemPrompt(sessionId)).toContain('Background character prompt')
    expect(store.getSessionSystemPrompt(store.activeSessionId)).not.toContain('Background character prompt')
  })

  it('ends every system prompt with the current stage contract and refreshes the active stored system message', async () => {
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leader = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    setActivePinia(leader.pinia)
    const store = useChatSessionStore()
    await store.initialize()
    const active = store.activeSessionId
    const background = await store.ensureCharacterSession('background-character')

    store.setStageContract('Stage contract A')
    await nextTick()

    expect(store.getSessionMessages(active)[0]?.content).toBe(store.getSessionSystemPrompt(active))
    expect(store.getSessionSystemPrompt(active).endsWith('\n\nStage contract A')).toBe(true)
    expect(String(store.getSessionMessages(active)[0]?.content).startsWith(CODE_BLOCK_SYSTEM_PROMPT + MATH_SYNTAX_SYSTEM_PROMPT)).toBe(true)

    store.setStageContract('Stage contract B')
    await nextTick()

    expect(store.getSessionMessages(active)[0]?.content).toBe(store.getSessionSystemPrompt(active))
    expect(store.getSessionSystemPrompt(active)).not.toContain('Stage contract A')
    // A request for an inactive session reads its prompt again, so it also ends with the new contract.
    expect(store.getSessionSystemPrompt(background).endsWith('\n\nStage contract B')).toBe(true)
  })

  it('places the register section between the character prompt and the stage contract and rewrites the active system message once per change', async () => {
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leader = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    setActivePinia(leader.pinia)
    const store = useChatSessionStore()
    await store.initialize()
    const active = store.activeSessionId
    store.setStageContract('Stage contract')
    await nextTick()
    const withoutRegister = store.getSessionSystemPrompt(active)
    const rewrites: unknown[] = []
    onTestFinished(watch(() => store.sessionMessages[active]?.[0]?.content, content => rewrites.push(content), { flush: 'sync' }))

    store.setRegisterPrompt('Register section')
    await nextTick()

    expect(rewrites).toEqual([store.getSessionSystemPrompt(active)])
    expect(store.getSessionSystemPrompt(active)).toBe(withoutRegister.replace(/\n\nStage contract$/, '\n\nRegister section\n\nStage contract'))

    // An empty section is left out, so the prompt is the one without a register again.
    store.setRegisterPrompt('')
    await nextTick()

    expect(rewrites).toEqual([expect.stringContaining('Register section'), withoutRegister])
    expect(store.getSessionMessages(active)[0]?.content).toBe(withoutRegister)
  })

  it('persists follower interruption retries once and preserves the first control event', async () => {
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leader = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    setActivePinia(leader.pinia)
    const leaderStore = useChatSessionStore()
    await leaderStore.initialize()
    const follower = createSyncedContext(namespace, 'follower-only')
    setActivePinia(follower.pinia)
    const followerStore = useChatSessionStore()
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
    await followerStore.initialize()
    const sessionId = followerStore.activeSessionId
    const before = leaderStore.getSessionMessages(sessionId).length
    const event = { eventId: 'interrupt-once', turn: { sessionId, turnId: 'reply' }, cause: 'button', playback: { groupId: 'audio', status: 'silent' as const, played: [] } }
    const persisted = Promise.withResolvers<void>()
    let cloneError: unknown
    vi.mocked(chatSessionsRepo.saveSession).mockImplementationOnce((_sessionId, record) => {
      try {
        structuredClone(record)
      }
      catch (error) {
        cloneError = error
      }
      return persisted.promise
    })
    let settled = false
    const receiving = followerStore.recordInterruption(event).then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(leaderStore.sessionMetas[sessionId]?.controlEvents).toHaveLength(1))
    expect(settled).toBe(false)
    persisted.resolve()
    await receiving
    expect(cloneError).toBeUndefined()
    await followerStore.recordInterruption({ ...event, cause: 'retry' })
    expect(leaderStore.sessionMetas[sessionId]?.controlEvents).toEqual([event])
    expect(leaderStore.getSessionMessages(sessionId)).toHaveLength(before)
    await vi.waitFor(() => expect(followerStore.sessionMetas[sessionId]?.controlEvents).toEqual([event]))
  })

  it('records a follower unprompted decline once and keeps only the newest 10 declines, without evicting interruptions', async () => {
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leader = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    setActivePinia(leader.pinia)
    const leaderStore = useChatSessionStore()
    await leaderStore.initialize()
    const follower = createSyncedContext(namespace, 'follower-only')
    setActivePinia(follower.pinia)
    const followerStore = useChatSessionStore()
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
    await followerStore.initialize()
    const sessionId = followerStore.activeSessionId
    const before = leaderStore.getSessionMessages(sessionId).length
    const decline = (index: number) => ({ eventId: `decline-${index}`, turn: { sessionId, turnId: `unprompted-${index}` }, topicKey: `topic-${index}`, atMs: 1000 + index })

    await followerStore.recordUnpromptedDecline(decline(0))
    await followerStore.recordUnpromptedDecline({ ...decline(0), topicKey: 'retry' })
    expect(leaderStore.sessionMetas[sessionId]?.controlEvents).toEqual([{ kind: 'unprompted-declined', ...decline(0) }])

    const interruption = { eventId: 'interrupt-kept', turn: { sessionId, turnId: 'reply' }, cause: 'button', playback: { groupId: 'audio', status: 'silent' as const, played: [] } }
    await leaderStore.recordInterruption(interruption)
    for (let index = 1; index <= 54; index++)
      await leaderStore.recordUnpromptedDecline(decline(index))

    // Declines are records that no prompt reads, so they stop growing the synced session at 10, and the interruption
    // that later voice requests read stays.
    const events = leaderStore.sessionMetas[sessionId]?.controlEvents ?? []
    expect(events).toEqual([interruption, ...Array.from({ length: 10 }, (_, offset) => ({ kind: 'unprompted-declined', ...decline(45 + offset) }))])
    // A decline adds no message. The runtime committed nothing for it.
    expect(leaderStore.getSessionMessages(sessionId)).toHaveLength(before)
    await vi.waitFor(() => expect(followerStore.sessionMetas[sessionId]?.controlEvents).toHaveLength(11))
  })

  it('acknowledges a follower submission after storage and deduplicates its retry', async () => {
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leader = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    setActivePinia(leader.pinia)
    const leaderStore = useChatSessionStore()
    await leaderStore.initialize()
    const follower = createSyncedContext(namespace, 'follower-only')
    setActivePinia(follower.pinia)
    const followerStore = useChatSessionStore()
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
    await followerStore.initialize()
    const sessionId = followerStore.activeSessionId
    const stored = Promise.withResolvers<void>()
    const saving = vi.mocked(chatSessionsRepo.saveSession).mockImplementationOnce(async () => stored.promise)
    const priorWrites = saving.mock.calls.length
    const message = { id: 'voice-submission', role: 'user' as const, content: 'Voice message' }
    let acknowledged = false
    const request = followerStore.commitUserMessage(sessionId, message).then((receipt) => {
      acknowledged = true
      return receipt
    })
    try {
      await vi.waitFor(() => expect(saving.mock.calls.length).toBe(priorWrites + 1))
      expect(acknowledged).toBe(false)
    }
    finally {
      stored.resolve()
    }
    expect(await request).toEqual({ status: 'inserted', messageId: 'voice-submission' })
    expect(await followerStore.commitUserMessage(sessionId, message)).toEqual({ status: 'existing', messageId: 'voice-submission' })
    expect(leaderStore.getSessionMessages(sessionId).filter(item => item.id === message.id)).toHaveLength(1)
    await vi.waitFor(() => expect(followerStore.getSessionMessages(sessionId).filter(item => item.id === message.id)).toHaveLength(1))
  })

  it('rejects a storage receipt when its session is deleted during persistence', async () => {
    const context = createSyncedContext(`chat-session:${crypto.randomUUID()}`, 'leader-only')
    await vi.waitFor(() => expect(context.runtime.isLeader()).toBe(true))
    setActivePinia(context.pinia)
    const store = useChatSessionStore()
    await store.initialize()
    const sessionId = store.activeSessionId
    const entered = Promise.withResolvers<void>()
    const stored = Promise.withResolvers<void>()
    vi.mocked(chatSessionsRepo.saveSession).mockImplementationOnce(async () => {
      entered.resolve()
      await stored.promise
    })
    const committing = store.commitUserMessage(sessionId, { id: 'removed-input', role: 'user', content: 'Hello' })
    const rejected = expect(committing).rejects.toThrow('Chat session changed before message persistence completed')
    await entered.promise
    const deleting = store.deleteSession(sessionId)
    stored.resolve()
    await rejected
    await deleting
    expect(store.sessionMetas[sessionId]).toBeUndefined()
  })

  it('initializes a follower through the canonical session action', async () => {
    // ROOT CAUSE: Initialization before leader election left followers without a session. Initialization now invokes the synchronized session action and stores its canonical result as the local selection.
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leaderContext = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leaderContext.runtime.isLeader()).toBe(true))

    setActivePinia(leaderContext.pinia)
    const leaderChatStore = useChatSessionStore()

    const followerContext = createSyncedContext(namespace, 'follower-only')
    setActivePinia(followerContext.pinia)
    const followerChatStore = useChatSessionStore()
    await vi.waitFor(() => expect(followerContext.runtime.getLeaderId()).toBe(leaderContext.runtime.participantId))

    await followerChatStore.initialize()

    expect(followerChatStore.activeSessionId).not.toBe('')
    expect(followerChatStore.activeSessionId).toBe(leaderChatStore.index?.characters.default?.activeSessionId)
    expect(followerChatStore.sessionMetas[followerChatStore.activeSessionId]).toBeDefined()
    expect(Object.keys(leaderChatStore.index?.characters.default?.sessions ?? {})).toHaveLength(1)
  })

  // https://github.com/moeru-ai/airi/issues/2595
  it('keeps a new conversation selected after its first synchronized message for Issue #2595', async () => {
    // ROOT CAUSE:
    //
    // The leader creates the session while the caller selects it locally.
    // The first message then synchronizes a new index ref. An index watcher
    // treated that data update as navigation and restored the old session.
    // Shared index updates no longer control window-local navigation.
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leaderContext = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leaderContext.runtime.isLeader()).toBe(true))

    setActivePinia(leaderContext.pinia)
    const leaderChatStore = useChatSessionStore()
    await leaderChatStore.initialize()
    const previousSessionId = leaderChatStore.activeSessionId

    const followerContext = createSyncedContext(namespace, 'follower-only')
    setActivePinia(followerContext.pinia)
    const followerChatStore = useChatSessionStore()
    await vi.waitFor(() => expect(followerContext.runtime.getLeaderId()).toBe(leaderContext.runtime.participantId))
    await followerChatStore.initialize()

    const newSessionId = await followerChatStore.createSession('default', { setActive: false })
    await followerChatStore.setActiveSession(newSessionId)
    followerChatStore.appendSessionMessage(newSessionId, {
      id: 'first-user-message',
      role: 'user',
      content: 'Hello',
    })

    await vi.waitFor(() => expect(leaderChatStore.sessionMessages[newSessionId]).toHaveLength(2))
    await vi.waitFor(() => expect(followerChatStore.sessionMessages[newSessionId]).toHaveLength(2))

    expect(previousSessionId).not.toBe(newSessionId)
    expect(followerChatStore.activeSessionId).toBe(newSessionId)
  })
})
