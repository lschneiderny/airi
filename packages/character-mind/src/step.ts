import type { MindIntent, MindRandom, MindSlowState, MindState, MindStimulus } from './types'

import { createReactionState, initialTouchAffectMemory } from '@proj-airi/stage-shared/expression-performance'
import { initialReactionMemory } from '@proj-airi/stage-shared/situation'

import { answerCursor, answerInteraction } from './attention'
import { answerChat } from './chat'
import { answerEmotion, answerExpressionClear, answerExpressionRequest } from './expression'
import { advanceIdle, answerIdle, answerIdlePlay, initialMindIdleState } from './idle'
import { answerMusic } from './music'
import { answerPresence, answerScreenChange } from './presence'
import { answerTouch } from './touch'
import { answerUserTurn, answerVoiceOutcome, answerVoiceRequest, answerVoiceTick, followPacing } from './voice'

/**
 * The state of a mind that has answered nothing, with the slow state the host loaded. It holds no random source:
 * every draw comes from `step`'s `rng`.
 */
export function initialMindState(slow: MindSlowState = { pacing: null }): MindState {
  return {
    seq: 0,
    reaction: createReactionState(),
    touch: { affect: initialTouchAffectMemory },
    voice: { reaction: initialReactionMemory(), lastDecision: null, gate: null, runId: null, stageShown: false, line: null, requests: [], lastGate: null },
    presence: { away: false, awaySinceMs: null },
    desktop: { screenReactAtMs: null },
    idle: initialMindIdleState(),
    music: { playing: false },
    attention: { random: null },
    slow,
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
export function step(state: MindState, stimuli: readonly MindStimulus[], nowMs: number, rng: MindRandom): { state: MindState, intents: MindIntent[] } {
  const atSeconds = nowMs / 1000
  const intents: MindIntent[] = []
  // A desktop wake anywhere in the call wins over a screen change in the same call.
  const wakes = stimuli.some(stimulus => stimulus.kind === 'presence' && stimulus.wake !== null)
  let next = state
  for (const stimulus of stimuli) {
    const cause = next.seq + 1
    next = { ...next, seq: cause }
    // The idle clock catches up first, so a decision that fell due before this stimulus comes before its answer.
    const due = advanceIdle(next, cause, nowMs)
    next = due.state
    intents.push(...due.intents)

    let answer: { state: MindState, intents: MindIntent[] }
    if (stimulus.kind === 'emotion')
      answer = answerEmotion(next, stimulus, cause, atSeconds, rng)
    else if (stimulus.kind === 'expression-request')
      answer = answerExpressionRequest(next, stimulus, cause, atSeconds, rng)
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
      answer = answerUserTurn(next, nowMs)
    else if (stimulus.kind === 'voice-request')
      answer = answerVoiceRequest(next, stimulus, cause, nowMs, rng)
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

    next = answer.state.voice.gate === next.voice.gate ? answer.state : followPacing(answer.state)
    intents.push(...answer.intents)
  }

  return { state: next, intents }
}
