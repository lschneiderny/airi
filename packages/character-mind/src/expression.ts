import type { MindIntent, MindState, MindStimulus } from './types'

import { acceptReaction, emotionHold, releaseHold } from '@proj-airi/stage-shared/expression-performance'

/** The dose of every emotion when the card turns band recruitment off. */
const BANDLESS_NOMINAL = 0.6

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[] }

/**
 * An emotion becomes an episode with its hold. A neutral that resets the reaction state releases the automatic
 * slots and the hold. A repeat that neither starts nor escalates an episode yields no intent.
 */
export function answerEmotion(state: MindState, stimulus: Stimulus<'emotion'>, cause: number, atSeconds: number): Answer {
  const { settings, turnId } = stimulus
  const reaction = acceptReaction(state.reaction, stimulus.emotion, settings.bands ? stimulus.nominal : BANDLESS_NOMINAL, atSeconds, settings)
  const next = { ...state, reaction: reaction.state }
  if (stimulus.emotion === 'neutral' && reaction.state !== state.reaction)
    return { state: next, intents: [{ id: `${cause}-release`, cause, channel: 'face', kind: 'release', scope: 'neutral', hold: releaseHold(turnId), reason: stimulus.source, turnId }] }

  const episode = reaction.episode
  if (!episode)
    return { state: next, intents: [] }

  return { state: next, intents: [{ id: `${cause}-emotion`, cause, channel: 'face', kind: 'emotion', episode, hold: emotionHold(episode, turnId, settings), reason: stimulus.source, turnId }] }
}

/**
 * A named entry with an emotion mapping is accepted like an emotion at the mapping's minimum band, so the held
 * face follows what the model chose. The hold mirrors the entry's lease. A repeat inside the running episode
 * yields no new episode but still refreshes the hold at the running episode's strength.
 *
 * Without a mapping, or with held emotions off, the reaction state is untouched and the entry travels alone.
 */
export function answerExpressionRequest(state: MindState, stimulus: Stimulus<'expression-request'>, cause: number, atSeconds: number): Answer {
  const { settings, turnId, lease } = stimulus
  const entry = { id: `${cause}-entry`, cause, channel: 'face', kind: 'entry', entryId: stimulus.entryId, reason: stimulus.source, turnId } as const
  const mapping = settings.heldEmotions ? stimulus.mapping : null
  if (!mapping)
    return { state, intents: [{ ...entry, episode: null, hold: null }] }

  const nominal = settings.bands ? settings.intensity[mapping.minBand] : BANDLESS_NOMINAL
  const reaction = acceptReaction(state.reaction, mapping.emotion, nominal, atSeconds, settings)
  const running = reaction.state.current?.episode
  const held = reaction.episode ?? (running?.emotion === mapping.emotion ? running : null)

  return {
    state: { ...state, reaction: reaction.state },
    intents: [{
      ...entry,
      episode: reaction.episode,
      // A configured zero dose has no running episode, but still refreshes the hold for the entry's lease.
      hold: { emotion: mapping.emotion, strength: held?.intensity ?? nominal, holdSeconds: lease.holdSeconds, until: lease.until, turnId },
    }],
  }
}

/** A clear keeps the reaction history, so a later escalation may show again. Only a clear of every slot releases the hold. */
export function answerExpressionClear(state: MindState, stimulus: Stimulus<'expression-clear'>, cause: number): Answer {
  const { slot, turnId } = stimulus

  return { state, intents: [{ id: `${cause}-release`, cause, channel: 'face', kind: 'release', scope: slot ?? 'all', hold: slot ? null : releaseHold(turnId), reason: stimulus.source, turnId }] }
}
