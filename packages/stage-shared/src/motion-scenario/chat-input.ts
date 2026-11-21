import type { ScenarioEvent } from './schema'

/**
 * The chat input a scenario drives, shaped like stage-ui-live2d's `NaturalChatInput`, which stage-shared must not import.
 * `target` is head widths from the eye anchor (x right, y up), or `null` while the chat is hidden.
 */
export interface ScenarioChatInput {
  target: { x: number, y: number } | null
  typing: boolean
}

/** Event kinds that drive the chat input. `chat-sent` and `chat-unfold` are reads, which a host sends on its own. */
export type ScenarioChatEvent = Extract<ScenarioEvent, { kind: 'chat-target' | 'chat-typing' }>

export function isScenarioChatEvent(event: ScenarioEvent): event is ScenarioChatEvent {
  return event.kind === 'chat-target' || event.kind === 'chat-typing'
}

/**
 * The chat input after one chat event, as a new object, so hosts that compare inputs by identity see the change.
 *
 * Before its first chat event a scenario has no chat signal (`null`), and Natural drops a chat read while it has no
 * chat signal. So a `chat-sent` or `chat-unfold` event before a scenario's first chat event does not glance; put a
 * `chat-target` event before it.
 */
export function nextScenarioChatInput(previous: ScenarioChatInput | null, event: ScenarioChatEvent): ScenarioChatInput {
  const chat = previous ?? { target: null, typing: false }
  switch (event.kind) {
    case 'chat-target':
      // The schema pairs `x` with `y`, so a non-clear event carries both.
      return { ...chat, target: event.clear ? null : { x: event.x!, y: event.y! } }
    case 'chat-typing':
      return { ...chat, typing: event.active }
  }
}
