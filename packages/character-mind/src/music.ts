import type { MindIntent, MindState, MindStimulus } from './types'

/**
 * Keeps whether she hears music. It draws nothing and yields nothing: the idle schedule reads it at its next pick, so
 * the groove (the `sway` act) weighs above 0 only while music plays. `step` has already brought the idle clock up to
 * `nowMs` under the old value, so a decision that fell due before the edge is taken as it would have been.
 */
export function answerMusic(state: MindState, stimulus: Extract<MindStimulus, { kind: 'music' }>): { state: MindState, intents: MindIntent[] } {
  if (state.music.playing === stimulus.playing)
    return { state, intents: [] }
  return { state: { ...state, music: { playing: stimulus.playing } }, intents: [] }
}
