import type { SparkNotifyResponseControl } from '@proj-airi/core-agent/agents/spark-notify'
import type { WebSocketBaseEvent, WebSocketEventOf, WebSocketEvents } from '@proj-airi/server-sdk'
import type { NotifyObservation } from '@proj-airi/stage-shared/situation'

import { createSparkNotifyAgent } from '@proj-airi/core-agent/agents/spark-notify'
import { notifyTopicKey } from '@proj-airi/stage-shared/situation'
import { defineStore, storeToRefs } from 'pinia'
import { ref } from 'vue'

import { useCharacterNotebookStore, useCharacterStore } from '../'
import { useStageContractPrompt, useStageLiveStatePrompt } from '../../../composables/use-airi-runtime-prompt'
import { getEventSourceKey } from '../../../utils/event-source'
import { useLLM } from '../../ai/chat-llm/llm'
import { useModsServerChannelStore } from '../../mods/api/channel-server'
import { useConsciousnessStore } from '../../modules/consciousness'
import { useSituationStore } from '../../situation'
import { ingestSparkNotify } from '../../situation/sensors/notify'

export { sparkNotifyCommandSchema } from '@proj-airi/core-agent/agents/spark-notify'

/**
 * How many notify ids each window remembers by topic key.
 *
 * Tuning: a reaction that the gate starts names only its notify topic, and each window looks the notify id up here.
 * Raise it if many notifications arrive before she speaks about an older one.
 */
const SPARK_NOTIFY_IDS_MAX = 256

export const useCharacterOrchestratorStore = defineStore('character-orchestrator', () => {
  const { stream } = useLLM()
  const consciousnessStore = useConsciousnessStore()
  const { activeProvider, activeModel } = storeToRefs(consciousnessStore)
  const characterStore = useCharacterStore()
  const notebookStore = useCharacterNotebookStore()
  const { systemPrompt } = storeToRefs(characterStore)
  const stageContractPrompt = useStageContractPrompt()
  const liveStatePrompt = useStageLiveStatePrompt()
  const modsServerChannelStore = useModsServerChannelStore()
  const situationStore = useSituationStore()

  const processing = ref(false)
  const pendingNotifies = ref<Array<WebSocketEventOf<'spark:notify'>>>([])

  const scheduledNotifies = ref<Array<{
    event: WebSocketEventOf<'spark:notify'>
    control?: SparkNotifyResponseControl
    enqueuedAt: number
    nextRunAt: number
    attempts: number
    maxAttempts: number
    reason?: string
  }>>([])

  const attentionConfig = ref({
    tickIntervalMs: 2_000,
    taskNotifyWindowMs: 60_000,
    requeueDelayMs: 30_000,
    maxAttempts: 3,
  })

  /** The `data.id` of every notify this window handled, by its topic key, oldest first. */
  const sparkNotifyIds = new Map<string, string>()

  let tickTimer: ReturnType<typeof setInterval> | undefined
  let initialized = false
  const eventUnsubscribes: Array<() => void> = []
  // The agent runs only for the commands of notifies addressed beyond the character. Whether the character speaks
  // about a notify is the situation gate's decision, so this agent has no reaction plugin and its text is ignored.
  const sparkNotifyAgent = createSparkNotifyAgent({
    runner: {
      run: request => stream(
        request.selectedChat.model,
        request.selectedChat.provider,
        request.conversation,
        {
          tools: request.tools,
          providerId: request.selectedChat.providerId,
          supportsTools: request.policy.supportsTools,
          waitForTools: request.policy.waitForTools,
          toolChoice: request.policy.toolChoice,
          onStreamEvent: request.onStreamEvent,
        },
      ),
    },
  })

  function rememberSparkNotifyId(event: WebSocketEventOf<'spark:notify'>, observation: NotifyObservation) {
    const id: unknown = event.data?.id
    if (typeof id !== 'string' || !id || !observation.eventId)
      return
    sparkNotifyIds.set(notifyTopicKey(observation.sourceKey, observation.eventId), id)
    const oldest = sparkNotifyIds.size > SPARK_NOTIFY_IDS_MAX ? sparkNotifyIds.keys().next().value : undefined
    if (oldest !== undefined)
      sparkNotifyIds.delete(oldest)
  }

  /**
   * Returns the `data.id` of the notify behind a notify topic key, when this window handled that notify.
   *
   * Use when:
   * - A spoken reaction names only its topic, for example one that the gate started in the leader, and the devtools
   *   reactions list of this window keys reactions by notify id.
   */
  function sparkNotifyIdOf(topicKey: string): string | undefined {
    return sparkNotifyIds.get(topicKey)
  }

  /** Whether a notify is addressed to any module besides the character, which only the commands-only agent serves. */
  function hasModuleDestinations(event: WebSocketEventOf<'spark:notify'>) {
    const destinations: unknown = event.data.destinations
    return Array.isArray(destinations) && destinations.some(destination => destination !== 'character')
  }

  function computeNextRunAt(event: WebSocketEventOf<'spark:notify'>, attempts: number) {
    const now = Date.now()
    const baseDelay = (() => {
      switch (event.data.urgency) {
        case 'immediate':
          return 0
        case 'soon':
          return 10_000
        case 'later':
          return 60_000
        default:
          return 30_000
      }
    })()

    return now + baseDelay + (attempts * attentionConfig.value.requeueDelayMs)
  }

  function removePending(eventId: string) {
    pendingNotifies.value = pendingNotifies.value.filter(item => item.data.id !== eventId)
  }

  function enqueueSparkNotify(
    event: WebSocketEventOf<'spark:notify'>,
    options?: {
      reason?: string
      nextRunAt?: number
      maxAttempts?: number
      control?: SparkNotifyResponseControl
    },
  ) {
    if (!pendingNotifies.value.some(item => item.data.id === event.data.id)) {
      pendingNotifies.value.push(event)
    }

    scheduledNotifies.value.push({
      event,
      control: options?.control,
      enqueuedAt: Date.now(),
      nextRunAt: options?.nextRunAt ?? computeNextRunAt(event, 0),
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? attentionConfig.value.maxAttempts,
      reason: options?.reason,
    })
  }

  async function processSparkNotify(event: WebSocketEventOf<'spark:notify'>, control?: SparkNotifyResponseControl) {
    const providerId = activeProvider.value
    const model = activeModel.value
    if (!providerId || !model) {
      console.warn('Spark notify ignored: missing active provider or model')
      return undefined
    }

    const provider = await consciousnessStore.getChatProviderInstance(providerId)
    processing.value = true

    try {
      const result = await sparkNotifyAgent.handle({
        event,
        selectedChat: {
          providerId,
          model,
          provider,
        },
        // The stable stage contract belongs to the system prompt. Only the live state rides with the notify.
        systemPrompt: [systemPrompt.value, stageContractPrompt.value].filter(Boolean).join('\n\n'),
        runtimePrompt: liveStatePrompt.value,
        control: { ...control, commandsOnly: true },
      })
      if (!result.commands.length)
        return result

      for (const command of result.commands) {
        modsServerChannelStore.send({
          type: 'spark:command',
          data: command,
        })
      }

      return result
    }
    finally {
      processing.value = false
    }
  }

  /**
   * Handles one `spark:notify`: it always becomes a situation observation, synchronously before the first await, and
   * the gate (or a widget reaction's forced turn) decides whether the character speaks about it. Only a notify with
   * destinations beyond `'character'`, or one whose caller forces a spark command, also runs the commands-only agent,
   * at once when it is immediate and the agent is idle, otherwise through the queue. Returns the agent result of an
   * immediate run, or `undefined`. A notify from a source the user does not share, such as the web extension while
   * browser sharing is off, is dropped before either step, so it reaches no model.
   */
  async function handleIncomingSparkNotify(event: WebSocketEventOf<'spark:notify'>, control?: SparkNotifyResponseControl) {
    if (!situationStore.sharesSource(getEventSourceKey(event)))
      return undefined
    rememberSparkNotifyId(event, ingestSparkNotify(event))
    if (!hasModuleDestinations(event) && !control?.forceSparkCommandResponse)
      return undefined

    if (event.data.urgency === 'immediate' && !processing.value) {
      return await processSparkNotify(event, control)
    }

    enqueueSparkNotify(event, { reason: 'spark:notify', control })
    return undefined
  }

  function enqueueDueTasks(now: number) {
    const dueTasks = notebookStore.getDueTasks(now, attentionConfig.value.taskNotifyWindowMs)
    if (!dueTasks.length)
      return

    for (const task of dueTasks) {
      const event: WebSocketEventOf<'spark:notify'> = {
        type: 'spark:notify',
        source: 'character:task-scheduler',
        data: {
          id: `task-${task.id}`,
          eventId: task.id,
          kind: 'reminder',
          urgency: task.priority === 'critical' ? 'immediate' : 'soon',
          headline: `Task reminder: ${task.title}`,
          note: task.details,
          destinations: ['character'],
          payload: {
            taskId: task.id,
            dueAt: task.dueAt,
            priority: task.priority,
          },
        },
      }

      // A reminder is for the character only, so it is an observation and never an agent run.
      rememberSparkNotifyId(event, ingestSparkNotify(event))
      notebookStore.markTaskNotified(task.id, now + attentionConfig.value.requeueDelayMs)
    }
  }

  async function tick() {
    if (processing.value)
      return

    const now = Date.now()
    enqueueDueTasks(now)

    const nextIndex = scheduledNotifies.value.findIndex(item => item.nextRunAt <= now)
    if (nextIndex < 0)
      return

    const [next] = scheduledNotifies.value.splice(nextIndex, 1)
    removePending(next.event.data.id)

    try {
      await processSparkNotify(next.event, next.control)
    }
    catch (error) {
      if (next.attempts + 1 < next.maxAttempts) {
        scheduledNotifies.value = [...scheduledNotifies.value, {
          ...next,
          attempts: next.attempts + 1,
          nextRunAt: computeNextRunAt(next.event, next.attempts + 1),
        }]
        pendingNotifies.value = [...pendingNotifies.value, next.event]
      }
      else {
        console.warn('Dropped spark:notify after max attempts:', error)
      }
    }
  }

  function startTicker() {
    if (tickTimer)
      return

    tickTimer = setInterval(() => {
      void tick()
    }, attentionConfig.value.tickIntervalMs)
  }

  function stopTicker() {
    if (!tickTimer)
      return

    clearInterval(tickTimer)
    tickTimer = undefined
  }

  async function handleSparkEmit(_: WebSocketBaseEvent<'spark:emit', WebSocketEvents['spark:emit']>) {
    // Currently no-op
    return undefined
  }

  function initialize() {
    if (initialized)
      return

    initialized = true

    eventUnsubscribes.push(
      modsServerChannelStore.onEvent('spark:notify', async (event) => {
        try {
          await handleIncomingSparkNotify(event)
        }
        catch (error) {
          console.warn('Failed to handle spark:notify event:', error)
        }
      }),
    )

    eventUnsubscribes.push(
      modsServerChannelStore.onEvent('spark:emit', async (event) => {
        try {
          await handleSparkEmit(event)
        }
        catch (error) {
          console.warn('Failed to handle spark:emit event:', error)
        }
      }),
    )

    startTicker()
  }

  function dispose() {
    stopTicker()

    for (const unsubscribe of eventUnsubscribes) {
      unsubscribe()
    }

    eventUnsubscribes.length = 0
    initialized = false
  }

  return {
    processing,
    pendingNotifies,
    scheduledNotifies,
    attentionConfig,

    initialize,
    startTicker,
    stopTicker,
    dispose,

    handleSparkNotify: handleIncomingSparkNotify,
    handleSparkEmit,
    sparkNotifyIdOf,
  }
})
