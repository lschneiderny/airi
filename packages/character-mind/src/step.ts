import type { MindIntent, MindRandom, MindState, MindStimulus } from './types'

import { createReactionState, initialTouchAffectMemory } from '@proj-airi/stage-shared/expression-performance'
import { initialReactionMemory } from '@proj-airi/stage-shared/situation'

import { answerEmotion, answerExpressionClear, answerExpressionRequest } from './expression'
import { answerTouch, answerVoiceOutcome } from './touch'

/** Keeps the voice checkpoint off the emotion checkpoint, so the two rules do not draw the same values. */
const VOICE_SEED_SALT = 0x9E3779B9

/**
 * The state of a mind that has answered nothing.
 *
 * TODO: drop `seed` when `acceptReaction` and `reactionPolicy` take their draws from `step`'s `rng`; until
 * then each keeps its own Mulberry32 checkpoint in its memory.
 */
export function initialMindState(seed: number): MindState {
  return {
    seq: 0,
    reaction: createReactionState(seed),
    touch: { affect: initialTouchAffectMemory },
    voice: { reaction: initialReactionMemory((seed ^ VOICE_SEED_SALT) >>> 0), lastDecision: null },
  }
}

/**
 * The pure core of the character mind: answers the stimuli in order and returns the next state with the intents.
 * It reads no clock and no global random source, and never mutates `state`.
 *
 * `nowMs` is epoch milliseconds and must not run backwards between calls: the rules drop a stimulus older than
 * the last one they accepted. Every stimulus advances `seq`, also when it yields no intent.
 */
export function step(state: MindState, stimuli: readonly MindStimulus[], nowMs: number, _rng: MindRandom): { state: MindState, intents: MindIntent[] } {
  const atSeconds = nowMs / 1000
  const intents: MindIntent[] = []
  let next = state
  for (const stimulus of stimuli) {
    const cause = next.seq + 1
    next = { ...next, seq: cause }

    let answer: { state: MindState, intents: MindIntent[] }
    if (stimulus.kind === 'emotion')
      answer = answerEmotion(next, stimulus, cause, atSeconds)
    else if (stimulus.kind === 'expression-request')
      answer = answerExpressionRequest(next, stimulus, cause, atSeconds)
    else if (stimulus.kind === 'expression-clear')
      answer = answerExpressionClear(next, stimulus, cause)
    else if (stimulus.kind === 'touch')
      answer = answerTouch(next, stimulus, cause, nowMs)
    else
      answer = answerVoiceOutcome(next, stimulus, nowMs)

    next = answer.state
    intents.push(...answer.intents)
  }

  return { state: next, intents }
}
