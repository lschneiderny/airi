import type { MotionQaEvent, MotionQaEventsResult } from '@proj-airi/stage-shared/motion-scenario'

import type { useChatStore } from '../../stores/chat'

import { normalizeActPayload } from '@proj-airi/pipelines-audio'
import { onScopeDispose, watch } from 'vue'

import { usePerformanceRuntimeState } from '../../features/performance/runtime-state'
import { useLlmStreamingControlStore } from '../../stores/ai/chat-llm/streaming-control'

export type MotionQaChatHooks = Pick<ReturnType<typeof useChatStore>, 'onBeforeMessageComposed' | 'onChatTurnComplete'>

/** Window-local, dev-only recorder. Its subscriptions never dispatch or modify performance state. */
export function useMotionQaEvents(options: { chat: MotionQaChatHooks, speaking: () => boolean }) {
  const events: MotionQaEvent[] = []
  let seq = 0
  let dropped = 0
  function record(kind: MotionQaEvent['kind'], payload: MotionQaEvent['payload']) {
    const small = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 500) : value]))
    events.push({ seq: ++seq, time: Date.now(), kind, payload: small })
    if (events.length > 512) {
      events.shift()
      dropped++
    }
  }

  const disposers = [
    options.chat.onBeforeMessageComposed(async (_text, context) => {
      record('turn', { phase: 'start', turnId: context.turnId })
    }),
    options.chat.onChatTurnComplete(async (turn, context) => {
      record('turn', { phase: 'end', turnId: context.turnId, text: turn.outputText.slice(0, 500) })
    }),
    useLlmStreamingControlStore().onSignal(async (signal, context) => {
      if (signal.type !== 'act')
        return
      const act = normalizeActPayload(signal.payload)
      record('act', {
        turnId: context.turnId ?? null,
        emotion: act.emotion?.name ?? null,
        gesture: act.gesture?.kind ?? null,
        action: act.action ?? null,
        expression: act.expression ?? null,
      })
    }),
  ]
  const performance = usePerformanceRuntimeState()
  watch(() => performance.active.map(item => ({ ...item })), (active, previous) => {
    for (const item of previous) {
      if (!active.some(next => next.slot === item.slot && next.label === item.label))
        record('expression', { phase: 'end', slot: item.slot, label: item.label.slice(0, 500) })
    }
    for (const item of active) {
      if (!previous.some(old => old.slot === item.slot && old.label === item.label))
        record('expression', { phase: 'start', slot: item.slot, label: item.label.slice(0, 500) })
    }
  }, { flush: 'sync' })
  watch(options.speaking, speaking => record('tts', { phase: speaking ? 'start' : 'end' }), { flush: 'sync' })
  onScopeDispose(() => disposers.forEach(dispose => dispose()))

  return {
    read(sinceSeq = 0): MotionQaEventsResult {
      return { events: events.filter(event => event.seq > sinceSeq), lastSeq: seq, dropped }
    },
  }
}
