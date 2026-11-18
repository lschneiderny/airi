import type { MindIntent, MindRandom, MindState, MindStimulus } from './types'

import { createReactionState, initialTouchAffectMemory } from '@proj-airi/stage-shared/expression-performance'
import { initialReactionMemory } from '@proj-airi/stage-shared/situation'

import { answerEmotion, answerExpressionClear, answerExpressionRequest } from './expression'
import { answerTouch, answerVoiceOutcome } from './touch'

/** The state of a mind that has answered nothing. It holds no random source: every draw comes from `step`'s `rng`. */
export function initialMindState(): MindState {
  return {
    seq: 0,
    reaction: createReactionState(),
    touch: { affect: initialTouchAffectMemory },
    voice: { reaction: initialReactionMemory(), lastDecision: null },
  }
}

/**
 * The pure core of the character mind: answers the stimuli in order and returns the next state with the intents.
 * It reads no clock and no global random source, and never mutates `state`. Every draw comes from `rng`, in the
 * order of the stimuli: one for the jitter of each new emotion episode, and one for each spoken touch reaction that
 * reaches its roll.
 *
 * `nowMs` is epoch milliseconds and must not run backwards between calls: the rules drop a stimulus older than
 * the last one they accepted. Every stimulus advances `seq`, also when it yields no intent.
 */
export function step(state: MindState, stimuli: readonly MindStimulus[], nowMs: number, rng: MindRandom): { state: MindState, intents: MindIntent[] } {
  const atSeconds = nowMs / 1000
  const intents: MindIntent[] = []
  let next = state
  for (const stimulus of stimuli) {
    const cause = next.seq + 1
    next = { ...next, seq: cause }

    let answer: { state: MindState, intents: MindIntent[] }
    if (stimulus.kind === 'emotion')
      answer = answerEmotion(next, stimulus, cause, atSeconds, rng)
    else if (stimulus.kind === 'expression-request')
      answer = answerExpressionRequest(next, stimulus, cause, atSeconds, rng)
    else if (stimulus.kind === 'expression-clear')
      answer = answerExpressionClear(next, stimulus, cause)
    else if (stimulus.kind === 'touch')
      answer = answerTouch(next, stimulus, cause, nowMs, rng)
    else
      answer = answerVoiceOutcome(next, stimulus, nowMs)

    next = answer.state
    intents.push(...answer.intents)
  }

  return { state: next, intents }
}
