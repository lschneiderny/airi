import type { EmotionBehaviorSettings, ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import type { EmotionGestureIntent, MindIntent, MindRandom, MindState, MindStimulus, Refusal } from './types'

import { acceptReaction, emotionHold, releaseHold } from '@proj-airi/stage-shared/expression-performance'

import { refusedAnswer } from './capabilities'
import { emotionGesture } from './gesture'

/** The dose of every emotion when the card turns band recruitment off. */
const BANDLESS_NOMINAL = 0.6

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[], refusals?: Refusal[] }

/**
 * The body gesture of a new or escalated episode. Without posture the intent still goes out, so `declaredAnswer`
 * reports it as undeclared, but the cooldown is not spent on a gesture no performer plays.
 */
function gestureOf(state: MindState, episode: ReactionEpisode, settings: EmotionBehaviorSettings, cause: number, atSeconds: number): { state: MindState, intents: EmotionGestureIntent[] } {
  const decided = emotionGesture(state.gesture, episode, settings, atSeconds)
  if (!decided.gesture)
    return { state, intents: [] }
  return {
    state: state.performer.posture ? { ...state, gesture: decided.memory } : state,
    intents: [{ id: `${cause}-emotion-gesture`, cause, channel: 'posture', kind: 'emotion-gesture', gesture: decided.gesture, episodeId: episode.id }],
  }
}

/**
 * An emotion becomes an episode with its hold, followed by its body gesture when it has one. A neutral that resets the reaction state releases the automatic
 * slots and the hold. A repeat that neither starts nor escalates an episode yields no intent.
 */
export function answerEmotion(state: MindState, stimulus: Stimulus<'emotion'>, cause: number, atSeconds: number, rng: MindRandom): Answer {
  if (!state.performer.face)
    return refusedAnswer(state, cause, 'emotion')

  const { settings, turnId } = stimulus
  const reaction = acceptReaction(state.reaction, stimulus.emotion, settings.bands ? stimulus.nominal : BANDLESS_NOMINAL, atSeconds, settings, rng)
  const next = { ...state, reaction: reaction.state }
  if (stimulus.emotion === 'neutral' && reaction.state !== state.reaction)
    return { state: next, intents: [{ id: `${cause}-release`, cause, channel: 'face', kind: 'release', scope: 'neutral', hold: releaseHold(turnId), reason: stimulus.source, turnId }] }

  const episode = reaction.episode
  if (!episode)
    return { state: next, intents: [] }

  const gesture = gestureOf(next, episode, settings, cause, atSeconds)
  return { state: gesture.state, intents: [{ id: `${cause}-emotion`, cause, channel: 'face', kind: 'emotion', episode, hold: emotionHold(episode, turnId, settings), reason: stimulus.source, turnId }, ...gesture.intents] }
}

/**
 * A named entry with an emotion mapping is accepted like an emotion at the mapping's minimum band, so the held
 * face follows what the model chose. The hold mirrors the entry's lease. A new or escalated episode is followed by its
 * body gesture, as for an emotion. A repeat inside the running episode yields no new episode but still refreshes the
 * hold at the running episode's strength.
 *
 * Without a mapping, or with held emotions off, the reaction state is untouched and the entry travels alone.
 */
export function answerExpressionRequest(state: MindState, stimulus: Stimulus<'expression-request'>, cause: number, atSeconds: number, rng: MindRandom): Answer {
  if (!state.performer.face)
    return refusedAnswer(state, cause, 'entry')

  const { settings, turnId, lease } = stimulus
  const entry = { id: `${cause}-entry`, cause, channel: 'face', kind: 'entry', entryId: stimulus.entryId, reason: stimulus.source, turnId } as const
  const mapping = settings.heldEmotions ? stimulus.mapping : null
  if (!mapping)
    return { state, intents: [{ ...entry, episode: null, hold: null }] }

  const nominal = settings.bands ? settings.intensity[mapping.minBand] : BANDLESS_NOMINAL
  const reaction = acceptReaction(state.reaction, mapping.emotion, nominal, atSeconds, settings, rng)
  const running = reaction.state.current?.episode
  const held = reaction.episode ?? (running?.emotion === mapping.emotion ? running : null)
  const next = { ...state, reaction: reaction.state }
  const gesture = reaction.episode ? gestureOf(next, reaction.episode, settings, cause, atSeconds) : { state: next, intents: [] }

  return {
    state: gesture.state,
    intents: [{
      ...entry,
      episode: reaction.episode,
      // A configured zero dose has no running episode, but still refreshes the hold for the entry's lease.
      hold: { emotion: mapping.emotion, strength: held?.intensity ?? nominal, holdSeconds: lease.holdSeconds, until: lease.until, turnId },
    }, ...gesture.intents],
  }
}

/** A clear keeps the reaction history, so a later escalation may show again. Only a clear of every slot releases the hold. */
export function answerExpressionClear(state: MindState, stimulus: Stimulus<'expression-clear'>, cause: number): Answer {
  if (!state.performer.face)
    return refusedAnswer(state, cause, 'release')

  const { slot, turnId } = stimulus

  return { state, intents: [{ id: `${cause}-release`, cause, channel: 'face', kind: 'release', scope: slot ?? 'all', hold: slot ? null : releaseHold(turnId), reason: stimulus.source, turnId }] }
}
