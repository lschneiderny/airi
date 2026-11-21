import type { MindIntent, MindState, MindStimulus } from './types'

import { attendIntent } from './attention'

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[] }

/**
 * Answers chat activity: she reads every sent message and every chat that unfolds, and a sent message also opens the
 * attend window. It draws nothing and changes no state; the performer keeps the read's delay, hold, and guards.
 */
export function answerChat(state: MindState, stimulus: Stimulus<'chat'>, cause: number): Answer {
  const words = stimulus.cue === 'sent' ? stimulus.words : 0
  const read: MindIntent = { id: `${cause}-chat-read`, cause, channel: 'gaze', kind: 'chat-read', cue: stimulus.cue, words }
  return { state, intents: stimulus.cue === 'sent' ? [read, attendIntent(cause)] : [read] }
}
