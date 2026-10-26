import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'

import type { NaturalChatInput } from './natural-motion'
import type { GazePoint } from './natural-motion/gaze'

/** Where the host's chat sits: shown or not, and its window rectangle in Electron DIP screen coordinates. */
export interface NaturalChatTarget {
  visible: boolean
  bounds: PlacementRect | null
}

/** Typing timing and typed-send counters from the host; never text. */
export interface NaturalChatActivity {
  typing: boolean
  sentSeq: number
  sentWords: number
}

const noActivity: NaturalChatActivity = { typing: false, sentSeq: 0, sentWords: 0 }

/**
 * Builds the chat input Natural receives on one composition.
 *
 * Returns:
 * - `null` when the setting is off or the host supplies no chat target (web, pocket), so their sends stay inert
 * - Otherwise an object, also while the chat is hidden, so the controller keeps its sequence baselines; the target is
 *   `null` unless the chat is visible with bounds and `locate` can place it
 */
export function naturalChatInput(options: {
  enabled: boolean
  chatTarget: NaturalChatTarget | undefined
  activity: NaturalChatActivity | undefined
  unfoldSeq: number
  /** Converts the chat bounds into the eye-anchored offset; `null` when the host has no screen placement. */
  locate: (bounds: PlacementRect) => GazePoint | null
}): NaturalChatInput | null {
  const { chatTarget } = options
  if (!options.enabled || chatTarget === undefined)
    return null
  const activity = options.activity ?? noActivity
  return {
    target: chatTarget.visible && chatTarget.bounds ? options.locate(chatTarget.bounds) : null,
    typing: activity.typing,
    sentSeq: activity.sentSeq,
    sentWords: activity.sentWords,
    unfoldSeq: options.unfoldSeq,
  }
}

/**
 * Counts chat unfolds: each hidden -> visible transition increments the sequence.
 * The first observation only records visibility, so a chat already open at startup never counts as an unfold.
 */
export function createUnfoldCounter() {
  let previous: boolean | undefined
  let seq = 0
  return {
    observe(visible: boolean) {
      if (previous === false && visible)
        seq++
      previous = visible
      return seq
    },
    get seq() {
      return seq
    },
  }
}
