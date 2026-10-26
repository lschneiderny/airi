import type { ChatAttentionTarget } from '../../../shared/eventa'

import { isEqual } from 'es-toolkit'

type ChatBounds = NonNullable<ChatAttentionTarget['bounds']>

/**
 * What the chat windows show right now. `window` is `undefined` when the
 * window of the saved mode is closed.
 */
export type ChatWindowSnapshot
  = | {
    mode: 'floating'
    window: { shown: boolean, bounds: ChatBounds } | undefined
    /** The chat button state. A folded chat is hidden or about to hide. */
    folded: boolean
    /** The chat content is hidden while it moves to the other side of the main window. */
    relocating: boolean
  }
  | {
    mode: 'legacy'
    window: { shown: boolean, minimized: boolean, bounds: ChatBounds } | undefined
  }

const hidden: ChatAttentionTarget = { visible: false, bounds: null }

/**
 * Returns where the character can look at the chat. Visibility does not
 * depend on the floating placement: an attached, free, or danmaku chat counts
 * the same while it is on screen.
 */
export function chatAttentionTargetOf(snapshot: ChatWindowSnapshot): ChatAttentionTarget {
  const { window } = snapshot
  if (!window || !window.shown)
    return hidden

  if (snapshot.mode === 'floating' && (snapshot.folded || snapshot.relocating))
    return hidden
  if (snapshot.mode === 'legacy' && snapshot.window?.minimized)
    return hidden

  return { visible: true, bounds: { ...window.bounds } }
}

/**
 * Sends the chat attention target to its listeners only when it changes.
 *
 * `update` is called for every window event that may move, show, or hide the
 * chat. It reads the target again and compares it deeply with the last one it
 * sent, so a burst of events that leaves the chat where it was sends nothing.
 * The first update always sends.
 */
export function createChatAttentionTargetFeed(read: () => ChatAttentionTarget) {
  const listeners = new Set<(target: ChatAttentionTarget) => void>()
  let last: ChatAttentionTarget | undefined

  return {
    update() {
      const next = read()
      if (last && isEqual(last, next))
        return
      last = next
      for (const listener of listeners)
        listener(next)
    },
    /** Returns the function that removes `listener`. */
    subscribe(listener: (target: ChatAttentionTarget) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
