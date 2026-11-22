import type { AttendIntent, MindIntent, MindRandom, MindState, MindStimulus, Refusal } from './types'

import { drawCursorEpisode } from '@proj-airi/motion-driver-natural/cursor-notice'
import { seedRng } from '@proj-airi/stage-shared/situation'

import { refusedAnswer } from './capabilities'
import { checkpointStream, drawSeed } from './random'

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[], refusals?: Refusal[] }

/** How long she attends to her user after an interaction: the window in which the body director may walk to the cursor. */
export const ATTEND_WINDOW_MS = 60_000

/** The `attend` intent that answers an interaction of the step `cause`. */
export function attendIntent(cause: number, attendCause: Extract<AttendIntent, { target: 'cursor' }>['attendCause']): AttendIntent {
  return { id: `${cause}-attend`, cause, channel: 'body', kind: 'attend', target: 'cursor', attendCause, windowMs: ATTEND_WINDOW_MS }
}

/**
 * Answers a cursor notice the performer could start with the episode drawn on the attention stream, which one draw of
 * `rng` seeds at the first `cursor` stimulus. Nothing else changes: an order the performer no longer awaits costs only
 * its draw.
 */
export function answerCursor(state: MindState, stimulus: Stimulus<'cursor'>, cause: number, rng: MindRandom): Answer {
  if (!state.performer.gaze)
    return refusedAnswer(state, cause, 'cursor-episode')

  const stream = checkpointStream(state.attention.random ?? seedRng(drawSeed(rng)))
  const episode = drawCursorEpisode(stimulus.report.band, stream.random)
  return {
    state: { ...state, attention: { random: stream.checkpoint() } },
    intents: [{ id: `${cause}-cursor-episode`, cause, channel: 'gaze', kind: 'cursor-episode', requestId: stimulus.report.requestId, episode }],
  }
}

/** Answers a drag release: she attends to her user for `ATTEND_WINDOW_MS`. Nothing else changes. */
export function answerInteraction(state: MindState, cause: number): Answer {
  if (!state.performer.body)
    return refusedAnswer(state, cause, 'attend')

  return { state, intents: [attendIntent(cause, 'drag')] }
}
