import type { CharacterMind, MindState } from '@proj-airi/character-mind'
import type { IdleBehaviourReport } from '@proj-airi/motion-driver-natural/idle-activities'
import type { MotionQaEvent, MotionQaEventsResult } from '@proj-airi/stage-shared/motion-scenario'

import type { PerformerRefusal } from '../../features/performance/runtime-state'
import type { useChatStore } from '../../stores/chat'

import { normalizeActPayload } from '@proj-airi/pipelines-audio'
import { onScopeDispose, watch } from 'vue'

import { usePerformanceRuntimeState } from '../../features/performance/runtime-state'
import { useLlmStreamingControlStore } from '../../stores/ai/chat-llm/streaming-control'
import { voiceDecisionOf } from '../../stores/character-mind'

/** Subscribes to the stage's idle reports, as `createEventHook().on` does. */
export type MotionQaIdleHook = (listener: (report: IdleBehaviourReport) => void) => { off: () => void }

export type MotionQaChatHooks = Pick<ReturnType<typeof useChatStore>, 'onBeforeMessageComposed' | 'onChatTurnComplete'>

/** Window-local, dev-only recorder. Its subscriptions never dispatch or modify performance state. */
export function useMotionQaEvents(options: {
  chat: MotionQaChatHooks
  voicing: () => boolean
  mind: Pick<CharacterMind, 'onStep'>
  onIdle: MotionQaIdleHook
  onRefusal?: (listener: (refusal: PerformerRefusal) => void) => () => void
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
    ...options.onRefusal ? [options.onRefusal(refusal => record('mind', { stimulus: 'performer-refusal', refusals: JSON.stringify([refusal]) }))] : [],
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
    // One event per step of the mind, naming its stimuli and decisions, never a point, dose, view, or text.
    // A step of unforced gate ticks and idle reports or wakes that yields nothing would fill the ring, so it is skipped.
    options.mind.onStep((step) => {
      const ticks = step.stimuli.filter(stimulus => stimulus.kind === 'voice-tick')
      // The mind writes `lastGate` only when the gate evaluates; a tick skipped for an open line keeps the old one.
      const gate = step.state.voice.lastGate !== lastGate ? step.state.voice.lastGate : null
      lastGate = step.state.voice.lastGate
      const quiet = step.stimuli.every(stimulus => stimulus.kind === 'idle' || stimulus.kind === 'idle-wake' || (stimulus.kind === 'voice-tick' && !stimulus.forceTiming))
      if (quiet && !step.intents.length && !step.refusals.length)
        return
      const touches = step.stimuli.filter(stimulus => stimulus.kind === 'touch')
      const outcomes = step.stimuli.filter(stimulus => stimulus.kind === 'voice-outcome')
      const decision = voiceDecisionOf(step)
      const presence = step.stimuli.find(stimulus => stimulus.kind === 'presence')
      const music = step.stimuli.findLast(stimulus => stimulus.kind === 'music')
      const cursor = step.stimuli.find(stimulus => stimulus.kind === 'cursor')
      const interaction = step.stimuli.find(stimulus => stimulus.kind === 'interaction')
      const chat = step.stimuli.find(stimulus => stimulus.kind === 'chat')
      const lines = step.intents.flatMap(intent => intent.channel === 'voice' && intent.kind === 'speak' ? [intent.line.kind] : [])
      const cues = step.intents.flatMap(intent => intent.channel === 'posture' && intent.kind === 'cue' ? [intent.cue] : [])
      record('mind', {
        refusals: JSON.stringify(step.refusals),
        stimulus: step.stimuli.map(stimulus => stimulus.kind).join(','),
        gesture: touches.length ? touches.map(touch => touch.gesture).join(',') : null,
        outcome: outcomes.length ? outcomes.map(stimulus => stimulus.outcome).join(',') : null,
        // A JSON array, because a payload holds scalars only. A touch yields at most five intents of about 80
        // characters each, which stays under the 500 characters `record` keeps of a string.
        // Idle acts, idle errands, settles, cursor episodes, attend windows, chat reads, and gestures also name what they decided.
        intents: JSON.stringify(step.intents.map(intent => ({
          channel: intent.channel,
          kind: intent.kind,
          id: intent.id,
          cause: intent.cause,
          ...intent.kind === 'idle-act' && { act: intent.act, requested: intent.requested },
          ...intent.kind === 'idle-errand' && { errand: intent.errand },
          ...intent.kind === 'settle' && { settled: intent.settled },
          ...intent.kind === 'cursor-episode' && { band: intent.episode.band, engaging: intent.episode.engaging },
          ...intent.kind === 'attend' && { target: intent.target, attendCause: intent.attendCause, ...intent.target === 'cursor' && { windowMs: intent.windowMs } },
          ...intent.kind === 'away' && { away: intent.away },
          ...intent.kind === 'chat-read' && { cue: intent.cue, words: intent.words },
          ...intent.kind === 'gesture' && { gesture: intent.gesture, count: intent.count },
          ...intent.kind === 'emotion-gesture' && { gesture: intent.gesture },
        }))),
        // The kinds of the step's spoken lines (`reaction`, `reach-out`, `widget`) and its body cues
        // (`about-to-speak`, `let-go`), comma-separated, or null.
        lines: lines.length ? lines.join(',') : null,
        cues: cues.length ? cues.join(',') : null,
        voice: decision ? (decision.speak ? 'speak' : 'hold') : null,
        voiceLine: decision?.kind ?? null,
        voiceReason: decision && !decision.speak ? decision.reason : null,
        // Only a gate tick carries these: the fire or hold reason of its evaluation, null when the gate skipped, and
        // the category of a fire.
        ...ticks.length > 0 && { gate: gate?.reason ?? null, category: gate?.fire ? gate.category : null },
        // Only a presence step carries these: whether the user is away after it, and what woke the computer.
        ...presence && { away: presence.away, wake: presence.wake?.cause ?? null },
        // Whether a `music` stimulus said music started (true) or stopped (false); null for a step without one.
        music: music?.playing ?? null,
        // Only a cursor step carries these: the band of the cursor and what made the notice possible.
        ...cursor && { band: cursor.report.band, opportunity: cursor.report.opportunity },
        // Only an interaction step carries this: a drag release.
        ...interaction && { source: interaction.source },
        // Only a chat step carries this: a typed send (`sent`) or a chat that unfolded (`unfold`).
        ...chat && { chat: chat.cue },
      })
    }),
    options.onIdle((report) => {
      record('idle', { phase: report.phase, behaviour: report.behaviour })
      if (report.groove)
        record('groove-lock', { beatSeconds: report.groove.beatSeconds, beatsPerCycle: report.groove.beatsPerCycle })
    }).off,
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
