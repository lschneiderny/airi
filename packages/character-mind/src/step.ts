import type { MindAnswer, MindIntent, MindRandom, MindSlowState, MindState, MindStimulus, Refusal } from './types'

import { dormantIdleView } from '@proj-airi/motion-driver-natural/idle-schedule'
import { createReactionState, initialTouchAffectMemory } from '@proj-airi/stage-shared/expression-performance'
import { initialReactionMemory } from '@proj-airi/stage-shared/situation'

import { answerCursor, answerInteraction } from './attention'
import { declaredAnswer, NO_CAPABILITIES } from './capabilities'
import { answerChat } from './chat'
import { answerEmotion, answerExpressionClear, answerExpressionRequest } from './expression'
import { initialMindGestureState } from './gesture'
import { advanceIdle, answerIdle, answerIdlePlay, followSettleView, initialMindIdleState, interruptSettle } from './idle'
import { initialMindMoodState } from './mood'
import { answerMusic } from './music'
import { answerPresence, answerScreenChange } from './presence'
import { answerTouch } from './touch'
import { answerNoticeRequest, answerUserTurn, answerVoiceOutcome, answerVoiceRequest, answerVoiceTick, followPacing } from './voice'

/**
 * The state of a mind that has answered nothing, with the slow state the host loaded. It holds no random source:
 * every draw comes from `step`'s `rng`.
 */
export function initialMindState(slow: MindSlowState = { pacing: null }): MindState {
  return {
    seq: 0,
    performer: NO_CAPABILITIES,
    behavior: { idleActivities: true, touchReactions: true, chatAttention: true },
    reaction: createReactionState(),
    gesture: initialMindGestureState,
    mood: initialMindMoodState,
    touch: { affect: initialTouchAffectMemory },
    voice: { reaction: initialReactionMemory(), lastDecision: null, gate: null, runId: null, stageShown: false, line: null, requests: [], notices: [], lastGate: null },
    presence: { away: false, awaySinceMs: null },
    desktop: { screenReactAtMs: null },
    idle: initialMindIdleState(),
    music: { playing: false },
    attention: { random: null },
    slow,
  }
}

/**
 * Whether an answered stimulus claims her as Natural's `interrupt` did, so her settling starts over (CM9c, decision
 * D11): a touch, an emotion, an entry that started an episode, a cue gesture, a desktop wake, a screen change, a chat
 * cue, an engaged cursor episode, and every posture cue around a line.
 */
function interruptsSettle(stimulus: MindStimulus, intents: readonly MindIntent[]): boolean {
  switch (stimulus.kind) {
    case 'touch':
    case 'emotion':
    case 'cue-gesture':
    case 'screen-change':
    case 'chat':
      return true
    case 'presence':
      return stimulus.wake !== null
    case 'expression-request':
      return intents.some(intent => intent.kind === 'entry' && intent.episode !== null)
    case 'cursor':
      return intents.some(intent => intent.kind === 'cursor-episode' && intent.episode.engaging)
    default:
      return intents.some(intent => intent.kind === 'cue')
  }
}

/**
 * The pure core of the character mind: answers the stimuli in order and returns the next state with the intents.
 * It reads no clock and no global random source, and never mutates `state`. Every draw comes from `rng`, in the
 * order of the stimuli: one for the jitter of each new emotion episode, one for each spoken touch reaction that
 * reaches its roll, one for the threshold of each new gate run (at its first tick or widget request), the urge gate's own draws at each tick it evaluates, one
 * that seeds the idle policy's own stream at the first `idle` or `idle-play` stimulus, and one that seeds the
 * attention policy's own stream at the first `cursor` stimulus.
 *
 * `nowMs` is epoch milliseconds and must not run backwards between calls: the rules drop a stimulus older than
 * the last one they accepted. Every stimulus advances `seq`, also when it yields no intent. After each answer,
 * `slow.pacing` follows her pacing in the gate memory.
 */
export function step(state: MindState, stimuli: readonly MindStimulus[], nowMs: number, rng: MindRandom): { state: MindState, intents: MindIntent[], refusals: Refusal[] } {
  const intents: MindIntent[] = []
  const refusals: Refusal[] = []
  // A desktop wake anywhere in the call wins over a screen change in the same call.
  const wakes = stimuli.some(stimulus => stimulus.kind === 'presence' && stimulus.wake !== null)
  let next = state
  for (const stimulus of stimuli) {
    const cause = next.seq + 1
    next = { ...next, seq: cause }
    if (stimulus.kind === 'behavior') {
      const { idleActivities, touchReactions, chatAttention } = stimulus
      next = { ...next, behavior: { idleActivities, touchReactions, chatAttention } }
      if (!idleActivities) {
        next = {
          ...next,
          idle: {
            ...next.idle,
            view: next.idle.view === null ? null : dormantIdleView(next.idle.view.active),
            pending: null,
            schedule: { ...next.idle.schedule, followUp: null, awaySince: null },
          },
        }
        // The dormant view gets her up.
        const followed = followSettleView(next, `${cause}-settle`, cause)
        next = followed.state
        intents.push(...followed.intents)
      }
      // Withdrawing touch permission closes a granted pet without dosing or speaking for its cancellation.
      if (!touchReactions && next.touch.affect.pet !== null)
        next = { ...next, touch: { affect: { ...next.touch.affect, pet: null } } }
      continue
    }
    if (stimulus.kind === 'performer') {
      next = { ...next, performer: stimulus.capabilities }
      // Retire the previous performer's view before any due decision; a new stage reports its own view.
      // A performer without posture cannot take the settle edge: the count clears without one, and the conductor seeds
      // the mind's settle into a stage whose posture returns.
      if (!stimulus.capabilities.posture)
        next = { ...next, idle: { ...next.idle, view: dormantIdleView(), pending: null, atMs: nowMs, settle: { since: null, settled: false }, schedule: { ...next.idle.schedule, followUp: null, awaySince: null } } }
      continue
    }
    // The idle clock catches up first, so a decision that fell due before this stimulus comes before its answer.
    const due = advanceIdle(next, cause, nowMs)
    next = due.state
    intents.push(...due.intents)

    let answer: MindAnswer
    if (stimulus.kind === 'emotion')
      answer = answerEmotion(next, stimulus, cause, nowMs, rng)
    else if (stimulus.kind === 'expression-request')
      answer = answerExpressionRequest(next, stimulus, cause, nowMs, rng)
    else if (stimulus.kind === 'expression-clear')
      answer = answerExpressionClear(next, stimulus, cause)
    else if (stimulus.kind === 'touch')
      answer = answerTouch(next, stimulus, cause, nowMs, rng)
    else if (stimulus.kind === 'presence')
      answer = answerPresence(next, stimulus, cause, nowMs)
    else if (stimulus.kind === 'screen-change')
      answer = answerScreenChange(next, cause, nowMs, wakes)
    else if (stimulus.kind === 'voice-tick')
      answer = answerVoiceTick(next, stimulus, cause, nowMs, rng)
    else if (stimulus.kind === 'user-turn')
      answer = answerUserTurn(next, nowMs, cause)
    else if (stimulus.kind === 'voice-request')
      answer = answerVoiceRequest(next, stimulus, cause, nowMs, rng)
    else if (stimulus.kind === 'notice-request')
      answer = answerNoticeRequest(next, stimulus, cause, nowMs, rng)
    else if (stimulus.kind === 'idle')
      answer = answerIdle(next, stimulus, cause, rng)
    else if (stimulus.kind === 'idle-play')
      answer = answerIdlePlay(next, stimulus, cause, rng)
    else if (stimulus.kind === 'cursor')
      answer = answerCursor(next, stimulus, cause, rng)
    else if (stimulus.kind === 'interaction')
      answer = answerInteraction(next, cause)
    else if (stimulus.kind === 'chat')
      answer = answerChat(next, stimulus, cause)
    else if (stimulus.kind === 'cue-gesture')
      answer = { state: next, intents: [{ id: `${cause}-gesture`, cause, channel: 'posture', kind: 'gesture', gesture: stimulus.gesture, count: stimulus.count }] }
    else if (stimulus.kind === 'idle-wake')
      answer = { state: next, intents: [] }
    else if (stimulus.kind === 'music')
      answer = answerMusic(next, stimulus)
    else
      answer = answerVoiceOutcome(next, stimulus, cause, nowMs)

    answer = declaredAnswer(answer)
    refusals.push(...answer.refusals ?? [])
    next = answer.state.voice.gate === next.voice.gate ? answer.state : followPacing(answer.state)
    intents.push(...answer.intents)
    if (interruptsSettle(stimulus, answer.intents)) {
      const interrupted = interruptSettle(next, cause)
      next = interrupted.state
      intents.push(...interrupted.intents)
    }
  }

  return { state: next, intents, refusals }
}
