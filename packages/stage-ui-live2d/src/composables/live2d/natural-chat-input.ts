import type { GazePoint } from '@proj-airi/motion-driver-natural/gaze'
import type { NaturalChatInput } from '@proj-airi/motion-driver-natural/natural-motion'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'

/** Where the host's chat sits: shown or not, and its window rectangle in Electron DIP screen coordinates. */
export interface NaturalChatTarget {
  visible: boolean
  bounds: PlacementRect | null
}

/** Typing timing from the host; never text. Sends reach Natural as chat reads the character mind decides. */
export interface NaturalChatActivity {
  typing: boolean
}

const noActivity: NaturalChatActivity = { typing: false }

/**
 * Builds the chat input Natural receives on one composition.
 *
 * Returns:
 * - `null` when the setting is off or the host supplies no chat target (web, pocket), so their chat reads stay inert
 * - Otherwise an object, also while the chat is hidden; the target is `null` unless the chat is visible with bounds and
 *   `locate` can place it
 */
export function naturalChatInput(options: {
  enabled: boolean
  chatTarget: NaturalChatTarget | undefined
  activity: NaturalChatActivity | undefined
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
  }
}
