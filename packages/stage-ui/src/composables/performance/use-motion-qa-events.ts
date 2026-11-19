import type { CharacterMind, MindState } from '@proj-airi/character-mind'
import type { IdleBehaviourReport } from '@proj-airi/motion-driver-natural/idle-activities'
import type { MotionQaEvent, MotionQaEventsResult } from '@proj-airi/stage-shared/motion-scenario'

import type { useChatStore } from '../../stores/chat'

import { normalizeActPayload } from '@proj-airi/pipelines-audio'
import { onScopeDispose, watch } from 'vue'

import { usePerformanceRuntimeState } from '../../features/performance/runtime-state'
import { useLlmStreamingControlStore } from '../../stores/ai/chat-llm/streaming-control'
import { voiceDecisionOf } from './use-character-mind'

/** Subscribes to the stage's idle reports, as `createEventHook().on` does. */
export type MotionQaIdleHook = (listener: (report: IdleBehaviourReport) => void) => { off: () => void }

export type MotionQaChatHooks = Pick<ReturnType<typeof useChatStore>, 'onBeforeMessageComposed' | 'onChatTurnComplete'>

/** Window-local, dev-only recorder. Its subscriptions never dispatch or modify performance state. */
export function useMotionQaEvents(options: {
  chat: MotionQaChatHooks
  voicing: () => boolean
  mind: Pick<CharacterMind, 'onStep'>
  onIdle: MotionQaIdleHook
}) {
  const events: MotionQaEvent[] = []
  let seq = 0
  let dropped = 0
  let lastGate: MindState['voice']['lastGate'] = null
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
    // One event per step of the mind. It names what the mind was given and what it decided, never a point, a
    // dose, a view of the situation, or any text. An unforced gate tick that yields nothing is not recorded: the
    // gate ticks every 2 s and would fill the ring.
    options.mind.onStep((step) => {
      const ticks = step.stimuli.filter(stimulus => stimulus.kind === 'voice-tick')
      // The mind writes `lastGate` only when the gate evaluates; a tick skipped for an open line keeps the old one.
      const gate = step.state.voice.lastGate !== lastGate ? step.state.voice.lastGate : null
      lastGate = step.state.voice.lastGate
      if (ticks.length === step.stimuli.length && !step.intents.length && !ticks.some(tick => tick.forceTiming))
        return
      const touches = step.stimuli.filter(stimulus => stimulus.kind === 'touch')
      const outcomes = step.stimuli.filter(stimulus => stimulus.kind === 'voice-outcome')
      const decision = voiceDecisionOf(step)
      const presence = step.stimuli.find(stimulus => stimulus.kind === 'presence')
      record('mind', {
        stimulus: step.stimuli.map(stimulus => stimulus.kind).join(','),
        gesture: touches.length ? touches.map(touch => touch.gesture).join(',') : null,
        outcome: outcomes.length ? outcomes.map(stimulus => stimulus.outcome).join(',') : null,
        // A JSON array, because a payload holds scalars only. A touch yields at most four intents of about 80
        // characters each, which stays under the 500 characters `record` keeps of a string.
        intents: JSON.stringify(step.intents.map(({ channel, kind, id, cause }) => ({ channel, kind, id, cause }))),
        voice: decision ? (decision.speak ? 'speak' : 'hold') : null,
        voiceLine: decision?.kind ?? null,
        voiceReason: decision && !decision.speak ? decision.reason : null,
        // Only a gate tick carries these: the fire or hold reason of its evaluation, null when the gate skipped, and
        // the category of a fire.
        ...ticks.length > 0 && { gate: gate?.reason ?? null, category: gate?.fire ? gate.category : null },
        // Only a presence step carries these: whether the user is away after it, and what woke the computer.
        ...presence && { away: presence.away, wake: presence.wake?.cause ?? null },
      })
    }),
    options.onIdle(report => record('idle', { phase: report.phase, behaviour: report.behaviour })).off,
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
  watch(options.voicing, voicing => record('tts', { phase: voicing ? 'start' : 'end' }), { flush: 'sync' })
  onScopeDispose(() => disposers.forEach(dispose => dispose()))

  return {
    read(sinceSeq = 0): MotionQaEventsResult {
      return { events: events.filter(event => event.seq > sinceSeq), lastSeq: seq, dropped }
    },
  }
}
