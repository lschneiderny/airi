import type { Conversation } from '@proj-airi/core-agent'
import type { WebSocketEventOf } from '@proj-airi/server-sdk'
/* eslint-disable style/indent-binary-ops */
/* eslint-disable style/operator-linebreak */
import type { Pinia, Store, StoreDefinition } from 'pinia'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { Mock } from 'vitest'
import type { UnwrapRef } from 'vue'
import type z from 'zod'

import type { LlmStreamOptions, StreamEvent } from '../../ai/chat-llm/llm'
import type { AiriCard } from '../../modules'

import { renderConversationPreview } from '@proj-airi/core-agent'
import { effectiveSalience, notifyTopicKey } from '@proj-airi/stage-shared/situation'
import { tool } from '@xsai/tool'
import { nanoid } from 'nanoid'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { sparkNotifyCommandSchema, useCharacterOrchestratorStore } from '.'
import { useCharacterNotebookStore } from '..'
import { useSituationSettings } from '../../../features/situation/settings'
import { useLLM } from '../../ai/chat-llm/llm'
import { useModsServerChannelStore } from '../../mods/api/channel-server'
import { useAiriCardStore, useConsciousnessStore } from '../../modules'
import { useProviderStore } from '../../providers/provider'
import { useSituationStore } from '../../situation'
import { TASK_SCHEDULER_SOURCE } from '../../situation/sensors/notify'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('en'),
    t: (key: string) => key,
    te: () => true,
  }),
}))

function mockedStore<TStoreDef extends (pinia?: Pinia) => unknown>(
  useStore: TStoreDef,
  pinia?: Pinia,
): TStoreDef extends StoreDefinition<
  infer Id,
  infer State,
  infer Getters,
  infer Actions
>
  ? Store<
    Id,
    State,
    Record<string, never>,
    {
      [K in keyof Actions]: Actions[K] extends (...args: any[]) => any
        ? // 👇 depends on your testing framework
        Mock<Actions[K]>
        : Actions[K]
    }
  > & {
    [K in keyof Getters]: UnwrapRef<Getters[K]>
  }
  : ReturnType<TStoreDef> {
  return useStore(pinia) as any
}

function getObjectSchema(schema?: Record<string, any>) {
  if (!schema)
    return undefined

  if (schema.type === 'object')
    return schema

  const candidates = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]
  return candidates.find((candidate: Record<string, any>) => candidate?.type === 'object')
}

function getArraySchema(schema?: Record<string, any>) {
  if (!schema)
    return undefined

  if (schema.type === 'array')
    return schema

  const candidates = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]
  return candidates.find((candidate: Record<string, any>) => candidate?.type === 'array')
}

/** A synced runtime that makes this window the leader at once, as the plugin reports the current role on subscribe. */
function leaderRuntime(): SyncedPiniaRuntime {
  return {
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
    isLeader: () => true,
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      listener(true)
      return vi.fn()
    }),
    participantId: 'orchestrator-test',
    plugin: vi.fn(),
  }
}

function notifyEvents(store: ReturnType<typeof useSituationStore>) {
  return store.state.events.filter(event => event.kind === 'notify')
}

describe('sparkNotifyCommandSchema', () => {
  it('emits strict objects in the json schema', async () => {
    const sparkTool = await tool({
      name: 'builtIn_sparkCommand',
      description: 'test',
      parameters: sparkNotifyCommandSchema,
      execute: async () => undefined,
    })

    const schema = sparkTool.function.parameters as Record<string, any>
    const commandsSchema = getArraySchema(schema.properties?.commands)
    const commandItemSchema = getObjectSchema(commandsSchema?.items)
    const guidanceSchema = getObjectSchema(commandItemSchema?.properties?.guidance)
    const personaSchema = getArraySchema(guidanceSchema?.properties?.persona)
    const personaItemSchema = getObjectSchema(personaSchema?.items)
    const optionsSchema = getArraySchema(guidanceSchema?.properties?.options)
    const optionsItemSchema = getObjectSchema(optionsSchema?.items)

    expect(schema.additionalProperties).toBe(false)
    expect(commandItemSchema?.additionalProperties).toBe(false)
    expect(guidanceSchema?.additionalProperties).toBe(false)
    expect(personaItemSchema?.additionalProperties).toBe(false)
    expect(optionsItemSchema?.additionalProperties).toBe(false)
  })
})

describe('store character-orchestrator', () => {
  const sendSparkCommandMock = vi.fn()
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)

    sendSparkCommandMock.mockReset()
    mockedStore(useModsServerChannelStore, pinia).send = sendSparkCommandMock

    const mockGetChatProviderInstance = vi.fn()
    mockedStore(useProviderStore, pinia).getChatProviderInstance = mockGetChatProviderInstance
    mockedStore(useProviderStore, pinia).getChatProviderInstance.mockResolvedValue({ generation: (model: string) => ({ protocol: 'chat-completions', config: { model, apiKey: 'test', baseURL: 'https://example.com/v1/' } }) })

    const consciousnessStore = useConsciousnessStore(pinia)
    consciousnessStore.activeProvider = 'mock-provider'
    consciousnessStore.activeModel = 'mock-model'

    const airiCardStore = useAiriCardStore(pinia)
    // @ts-expect-error - testing purpose
    airiCardStore.systemPrompt = 'You are a brave adventurer in Minecraft.'
    // @ts-expect-error - testing purpose
    airiCardStore.activeCard = {
      name: 'Hero',
      version: '1.0',
      extensions: {
        airi: {
          agents: {},
          modules: {
            consciousness: {
              provider: 'mock-provider',
              model: 'mock-model',
            },
            vision: {
              provider: 'mock-vision-provider',
              model: 'mock-vision-model',
            },
            speech: {
              provider: 'mock-speech-provider',
              model: 'mock-speech-model',
              voice_id: 'alloy',
            },
          },
        },
      },
    } satisfies AiriCard
  })

  afterEach(() => {
    useSituationStore(pinia).dispose()
    vi.useRealTimers()
  })

  it('turns a character-only spark:notify into one situation observation without an agent run', async () => {
    const mockStream = vi.fn()
    mockedStore(useLLM, pinia).stream = mockStream
    const situation = useSituationStore(pinia)
    situation.initialize(leaderRuntime())

    const store = useCharacterOrchestratorStore(pinia)
    const event: WebSocketEventOf<'spark:notify'> = {
      type: 'spark:notify',
      source: 'plugin:airi-plugin-web-extension',
      data: {
        id: nanoid(),
        eventId: nanoid(),
        kind: 'ping',
        urgency: 'soon',
        headline: 'User is watching: QA video',
        note: 'x'.repeat(300),
        destinations: ['character'],
      },
    }

    const result = await store.handleSparkNotify(event)
    // The same event delivered again (a reconnect, a re-sent notify) adds nothing.
    await store.handleSparkNotify(event)

    expect(result).toBeUndefined()
    expect(mockStream).not.toHaveBeenCalled()
    expect(sendSparkCommandMock).not.toHaveBeenCalled()
    expect(store.scheduledNotifies).toEqual([])
    const notifies = notifyEvents(situation)
    expect(notifies).toHaveLength(1)
    expect(notifies[0].topicKey).toBe(notifyTopicKey('plugin:airi-plugin-web-extension', event.data.eventId))
    expect(notifies[0].text).toBe(`User is watching: QA video: ${'x'.repeat(200)}`)
    expect(notifies[0].salience).toBe(0.7)
  })

  it('runs no agent and keeps no observation for a web extension notify while browser sharing is off', async () => {
    const mockStream = vi.fn()
    mockedStore(useLLM, pinia).stream = mockStream
    const situation = useSituationStore(pinia)
    situation.initialize(leaderRuntime())
    await useSituationSettings(pinia).update({ shareBrowserActivity: false })

    const store = useCharacterOrchestratorStore(pinia)
    // A module destination would otherwise run the commands-only agent at once, which sends the notify to the model.
    const event: WebSocketEventOf<'spark:notify'> = {
      type: 'spark:notify',
      source: 'proj-airi:plugin-web-extension',
      data: { id: nanoid(), eventId: nanoid(), kind: 'ping', urgency: 'immediate', headline: 'User is watching: QA video', destinations: ['character', 'minecraft'] },
    }

    expect(await store.handleSparkNotify(event)).toBeUndefined()
    expect(mockStream).not.toHaveBeenCalled()
    expect(sendSparkCommandMock).not.toHaveBeenCalled()
    expect(store.scheduledNotifies).toEqual([])
    expect(notifyEvents(situation)).toEqual([])
  })

  it('forwards a notify that a follower window received to the leader, which keeps one observation', async () => {
    const situation = useSituationStore(pinia)
    situation.initialize(leaderRuntime())
    // The devtools simulator runs in the settings window: a second Pinia whose situation store never leads.
    const followerPinia = createPinia()
    const follower = useCharacterOrchestratorStore(followerPinia)
    const event: WebSocketEventOf<'spark:notify'> = {
      type: 'spark:notify',
      source: 'devtools',
      data: { id: nanoid(), eventId: nanoid(), kind: 'ping', urgency: 'soon', headline: 'Simulated in a follower', destinations: ['character'] },
    }

    // Store helpers resolve the active Pinia, as each window has its own.
    setActivePinia(followerPinia)
    await follower.handleSparkNotify(event)
    setActivePinia(pinia)
    const topicKey = notifyTopicKey('devtools', event.data.eventId)
    expect(notifyEvents(situation).map(item => item.topicKey)).toEqual([topicKey])
    // A server notify reaches every window: the leader ingests it itself and also receives the follower's copy.
    await useCharacterOrchestratorStore(pinia).handleSparkNotify(event)

    expect(useSituationStore(followerPinia).state.events).toEqual([])
    expect(notifyEvents(situation).map(item => item.topicKey)).toEqual([topicKey])
  })

  it('ignores malformed spark:notify payloads without throwing or running the agent', async () => {
    const mockStream = vi.fn()
    mockedStore(useLLM, pinia).stream = mockStream
    const situation = useSituationStore(pinia)
    situation.initialize(leaderRuntime())
    const store = useCharacterOrchestratorStore(pinia)

    // Wire payloads that break the protocol, parsed the way the server channel parses them.
    const malformed = [
      '{"type":"spark:notify","source":"plugin:broken","data":{"headline":42,"eventId":"e-1","urgency":"soon","destinations":["character"]}}',
      '{"type":"spark:notify","source":"plugin:broken","data":{"headline":"No event id","urgency":"soon","destinations":["character"]}}',
      '{"type":"spark:notify","source":"plugin:broken","data":{"headline":"   ","eventId":"e-3","urgency":"soon","destinations":"minecraft"}}',
    ]
    for (const payload of malformed)
      await store.handleSparkNotify(JSON.parse(payload))

    expect(notifyEvents(situation)).toEqual([])
    expect(mockStream).not.toHaveBeenCalled()
  })

  it('raises a critical reminder at full salience and never re-creates it after it decays', async () => {
    vi.useFakeTimers()
    const mockStream = vi.fn()
    mockedStore(useLLM, pinia).stream = mockStream
    const situation = useSituationStore(pinia)
    situation.initialize(leaderRuntime())
    const notebook = useCharacterNotebookStore(pinia)
    const task = notebook.scheduleTask({ title: 'Stretch', priority: 'critical', dueAt: Date.now() })

    const store = useCharacterOrchestratorStore(pinia)
    store.startTicker()
    await vi.advanceTimersByTimeAsync(store.attentionConfig.tickIntervalMs)

    const topicKey = notifyTopicKey(TASK_SCHEDULER_SOURCE, task.id)
    const [reminder] = notifyEvents(situation)
    expect(reminder?.topicKey).toBe(topicKey)
    expect(store.sparkNotifyIdOf(topicKey)).toBe(`task-${task.id}`)
    expect(reminder?.salience).toBe(1)
    expect(reminder?.text).toBe('Task reminder: Stretch')
    situation.markAddressed(topicKey)

    // The scheduler re-sends the due reminder every 30 s; its event decays out of the ring within about two hours.
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    store.stopTicker()

    expect(notebook.tasks[0].lastNotifiedAt).toBeGreaterThan(Date.now() - 60_000)
    expect(effectiveSalience(reminder, Date.now())).toBeLessThan(0.05)
    expect(situation.state.events.filter(event => event.topicKey === topicKey)).toEqual([])
    expect(mockStream).not.toHaveBeenCalled()
  })

  it('runs the commands-only agent for module destinations, ignores its text, and sends its commands', async () => {
    const mockStream = vi.fn()
    mockedStore(useLLM, pinia).stream = mockStream
    mockedStore(useLLM, pinia).stream.mockImplementation(async (_model: string, _provider: unknown, _messages: unknown, options: any) => {
      if (options?.tools?.length) {
        await options.tools[1].execute({ commands: [{
          destinations: ['minecraft'],
          intent: 'action',
          priority: 'critical',
          interrupt: 'false',
          ack: 'ok',
          guidance: null,
        }] } satisfies z.infer<typeof sparkNotifyCommandSchema>)
      }

      await options?.onStreamEvent?.({ type: 'text-delta', text: 'Ahhh, got hit by zombie!' } satisfies StreamEvent)
      await options?.onStreamEvent?.({ type: 'finish' } satisfies StreamEvent)
    })

    const situation = useSituationStore(pinia)
    situation.initialize(leaderRuntime())

    const store = useCharacterOrchestratorStore(pinia)
    const event: WebSocketEventOf<'spark:notify'> = {
      type: 'spark:notify',
      source: 'minecraft',
      data: {
        id: nanoid(),
        eventId: nanoid(),
        kind: 'alarm',
        urgency: 'immediate',
        headline: 'Hit by zombie',
        destinations: ['character', 'minecraft'],
      },
    }

    const result = await store.handleSparkNotify(event)

    expect(result?.commands).toHaveLength(1)
    expect(result?.commands?.[0].destinations).toEqual([event.source])
    expect(result?.commands?.[0].parentEventId).toBe(event.data.id)
    expect(result?.commands?.[0].intent).toBe('action')
    expect(result?.commands?.[0].priority).toBe('critical')

    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(mockStream.mock.calls).toHaveLength(1)
    expect(mockStream.mock.calls[0][0]).toEqual('mock-model')
    expect(mockStream.mock.calls[0][1]).not.toBeNull()
    expect((mockStream.mock.calls[0][2] as Conversation).turns).toHaveLength(2)
    expect(mockStream.mock.calls[0][3]).toHaveProperty('tools')
    expect(mockStream.mock.calls[0][3].toolChoice).toBeUndefined()
    expect(mockStream.mock.calls[0][3].tools.map((item: { function: { name: string } }) => item.function.name)).toContain('builtIn_sparkNoResponse')
    expect(sendSparkCommandMock).toHaveBeenCalledTimes(1)
    expect(sendSparkCommandMock).toHaveBeenCalledWith({ type: 'spark:command', data: result?.commands[0] })

    // The agent's text is ignored: the gate decides from the observation whether she speaks, and a reply that she
    // speaks about the topic is recorded under this notify's id.
    const topicKey = notifyTopicKey('minecraft', event.data.eventId)
    expect(notifyEvents(situation).map(item => item.topicKey)).toEqual([topicKey])
    expect(store.sparkNotifyIdOf(topicKey)).toBe(event.data.id)
  })

  it('queues a non-immediate module notify for the commands-only agent', async () => {
    const mockStream = vi.fn()
    mockedStore(useLLM, pinia).stream = mockStream
    const store = useCharacterOrchestratorStore(pinia)
    const event: WebSocketEventOf<'spark:notify'> = {
      type: 'spark:notify',
      source: 'minecraft',
      data: { id: nanoid(), eventId: nanoid(), kind: 'ping', urgency: 'later', headline: 'Night falls', destinations: ['minecraft'] },
    }

    const result = await store.handleSparkNotify(event)

    expect(result).toBeUndefined()
    expect(mockStream).not.toHaveBeenCalled()
    expect(store.scheduledNotifies.map(item => item.event.data.id)).toEqual([event.data.id])
  })

  it('supports forcing spark-command responses', async () => {
    const mockStream = vi.fn()
    mockedStore(useLLM, pinia).stream = mockStream
    mockedStore(useLLM, pinia).stream.mockImplementation(async (_model: string, _provider: unknown, _messages: unknown, options: any) => {
      const sparkCommandTool = options?.tools?.find((tool: any) => tool.function?.name === 'builtIn_sparkCommand')
      await sparkCommandTool.execute({
        commands: [{
          destinations: ['minecraft'],
          intent: 'action',
          priority: 'high',
          interrupt: 'false',
          ack: 'go',
          guidance: null,
        }],
      } satisfies z.infer<typeof sparkNotifyCommandSchema>)
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'This should be ignored.' } satisfies StreamEvent)
      await options?.onStreamEvent?.({ type: 'finish' } satisfies StreamEvent)
    })

    const store = useCharacterOrchestratorStore(pinia)
    const event: WebSocketEventOf<'spark:notify'> = {
      type: 'spark:notify',
      source: 'minecraft',
      data: {
        id: nanoid(),
        eventId: nanoid(),
        kind: 'alarm',
        urgency: 'immediate',
        headline: 'Take cover',
        destinations: ['minecraft'],
      },
    }

    const result = await store.handleSparkNotify(event, {
      forceSparkCommandResponse: true,
    })

    const streamOptions = mockStream.mock.lastCall?.[3]
    expect(streamOptions).toMatchObject({
      supportsTools: true,
      toolChoice: {
        type: 'function',
        function: { name: 'builtIn_sparkCommand' },
      },
      waitForTools: true,
    })
    expect(result?.commands?.length).toBe(1)
    expect(sendSparkCommandMock).toHaveBeenCalledWith({
      type: 'spark:command',
      data: result?.commands[0],
    })
    // A window that is not the situation leader still names the notify, so a reaction shared by the leader finds it.
    expect(store.sparkNotifyIdOf(notifyTopicKey('minecraft', event.data.eventId))).toBe(event.data.id)
  })

  it('runs the forced command agent for a character-only notify when its caller forces a spark command', async () => {
    const mockStream = vi.fn(async (_model: string, _provider: unknown, _messages: unknown, options?: LlmStreamOptions) => {
      await options?.onStreamEvent?.({ type: 'finish' } satisfies StreamEvent)
    })
    mockedStore(useLLM, pinia).stream = mockStream
    const situation = useSituationStore(pinia)
    situation.initialize(leaderRuntime())
    const store = useCharacterOrchestratorStore(pinia)
    const event: WebSocketEventOf<'spark:notify'> = {
      type: 'spark:notify',
      source: 'plugin-module-host',
      data: { id: nanoid(), eventId: nanoid(), kind: 'ping', urgency: 'immediate', headline: 'Widget command', destinations: ['character'] },
    }

    await store.handleSparkNotify(event, { forceSparkCommandResponse: true })

    expect(mockStream).toHaveBeenCalledOnce()
    expect(mockStream.mock.calls[0][3]).toMatchObject({ toolChoice: { type: 'function', function: { name: 'builtIn_sparkCommand' } } })
    expect(notifyEvents(situation).map(item => item.topicKey)).toEqual([notifyTopicKey('plugin-module-host', event.data.eventId)])
  })

  // https://github.com/moeru-ai/airi/pull/2464#discussion_r3933609456
  it('preserves runtime rules when a Spark caller replaces the user payload', async () => {
    const mockStream = vi.fn()
    mockedStore(useLLM, pinia).stream = mockStream
    mockedStore(useLLM, pinia).stream.mockImplementation(async (_model: string, _provider: unknown, _messages: unknown, options: any) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'legacy-safe text' } satisfies StreamEvent)
      await options?.onStreamEvent?.({ type: 'finish' } satisfies StreamEvent)
    })

    const store = useCharacterOrchestratorStore(pinia)
    const event: WebSocketEventOf<'spark:notify'> = {
      type: 'spark:notify',
      source: 'plugin:airi-plugin-game-chess',
      data: {
        id: nanoid(),
        eventId: nanoid(),
        kind: 'ping',
        urgency: 'immediate',
        headline: 'Legacy rendering',
        destinations: ['character', 'plugin:airi-plugin-game-chess'],
      },
    }

    await store.handleSparkNotify(event, {
      messageOverride: {
        appendSystemInstructions: ['Plugin-specific hint'],
        appendUserSections: ['Rendered board snapshot'],
        replaceUserMessage: 'Replacement user payload',
      },
    })

    const context = mockStream.mock.lastCall?.[2] as Conversation | undefined
    const renderedMessages = context ? renderConversationPreview(context).map(message => message.content) : undefined
    expect(String(renderedMessages?.[0])).toContain('Plugin-specific hint')
    expect(String(renderedMessages?.[1])).toContain('Replacement user payload')
    expect(String(renderedMessages?.[1])).toContain('Rendered board snapshot')
    expect(String(renderedMessages?.[0])).toContain('base.prompt.emotion')
    expect(String(renderedMessages?.[0])).toContain('base.prompt.emoji')
    expect(String(renderedMessages?.[1])).not.toContain('base.prompt.emotion')
  })
})
