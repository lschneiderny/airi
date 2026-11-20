import type { MindIntent, MindRandom, MindState, MindStimulus } from './types'

import { drawCursorEpisode } from '@proj-airi/motion-driver-natural/cursor-notice'
import { seedRng } from '@proj-airi/stage-shared/situation'

import { checkpointStream, drawSeed } from './random'

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[] }

/**
 * Answers a cursor notice the performer could start with the episode drawn on the attention stream, which one draw of
 * `rng` seeds at the first `cursor` stimulus. Nothing else changes: an order the performer no longer awaits costs only
 * its draw.
 */
export function answerCursor(state: MindState, stimulus: Stimulus<'cursor'>, cause: number, rng: MindRandom): Answer {
  const stream = checkpointStream(state.attention.random ?? seedRng(drawSeed(rng)))
  const episode = drawCursorEpisode(stimulus.report.band, stream.random)
  return {
    state: { ...state, attention: { random: stream.checkpoint() } },
    intents: [{ id: `${cause}-cursor-episode`, cause, channel: 'gaze', kind: 'cursor-episode', requestId: stimulus.report.requestId, episode }],
  }
}
