import type { MindIntent, MindState, MindStimulus } from './types'

import { attendIntent } from './attention'

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[] }

/**
 * Answers chat activity: she reads and attends to every sent message and every chat that unfolds. A sent message
 * opens the cursor window; an unfold asks for an approach to the chat. It draws nothing and changes no state.
 */
export function answerChat(state: MindState, stimulus: Stimulus<'chat'>, cause: number): Answer {
  const words = stimulus.cue === 'sent' ? stimulus.words : 0
  const read: MindIntent = { id: `${cause}-chat-read`, cause, channel: 'gaze', kind: 'chat-read', cue: stimulus.cue, words }
  const attend: MindIntent = stimulus.cue === 'sent'
    ? attendIntent(cause, 'chat-send')
    : { id: `${cause}-attend`, cause, channel: 'body', kind: 'attend', target: 'chat', attendCause: 'chat-unfold' }
  return { state, intents: [read, attend] }
}
