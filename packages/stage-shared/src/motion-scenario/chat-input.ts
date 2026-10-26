import type { ScenarioEvent } from './schema'

/**
 * The chat input a scenario drives, shaped like stage-ui-live2d's `NaturalChatInput`, which stage-shared must not import.
 * `target` is head widths from the eye anchor (x right, y up), or `null` while the chat is hidden.
 */
export interface ScenarioChatInput {
  target: { x: number, y: number } | null
  typing: boolean
  sentSeq: number
  sentWords: number
  unfoldSeq: number
}

/** Event kinds that drive the chat input. */
export type ScenarioChatEvent = Extract<ScenarioEvent, { kind: 'chat-target' | 'chat-typing' | 'chat-sent' | 'chat-unfold' }>

export function isScenarioChatEvent(event: ScenarioEvent): event is ScenarioChatEvent {
  return event.kind === 'chat-target' || event.kind === 'chat-typing' || event.kind === 'chat-sent' || event.kind === 'chat-unfold'
}

/**
 * The chat input after one chat event, as a new object, so hosts that compare inputs by identity see the change.
 *
 * Before its first chat event a scenario has no chat signal (`null`). The first chat event creates the input from a
 * hidden chat with zero counters, and Natural records that first input's counters as its baseline without glancing.
 * So a `chat-sent` or `chat-unfold` event that is a scenario's first chat event does not glance; put a `chat-target`
 * event before it. A sent event increments `sentSeq` and sets `sentWords`; an unfold event increments `unfoldSeq`.
 */
export function nextScenarioChatInput(previous: ScenarioChatInput | null, event: ScenarioChatEvent): ScenarioChatInput {
  const chat = previous ?? { target: null, typing: false, sentSeq: 0, sentWords: 0, unfoldSeq: 0 }
  switch (event.kind) {
    case 'chat-target':
      // The schema pairs `x` with `y`, so a non-clear event carries both.
      return { ...chat, target: event.clear ? null : { x: event.x!, y: event.y! } }
    case 'chat-typing':
      return { ...chat, typing: event.active }
    case 'chat-sent':
      return { ...chat, sentSeq: chat.sentSeq + 1, sentWords: event.words }
    case 'chat-unfold':
      return { ...chat, unfoldSeq: chat.unfoldSeq + 1 }
  }
}
