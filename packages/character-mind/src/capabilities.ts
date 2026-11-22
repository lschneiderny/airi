import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'

import type { MindIntent } from './types'

/** Episodes a performer can realise at all; current assets and world geometry remain performer inputs. */
export interface PerformerCapabilities {
  readonly posture: boolean
  readonly face: boolean
  readonly gaze: boolean
  readonly gestures: readonly CueGestureKind[]
  readonly body: boolean
}

/** Upstream drivers and renderers outside the mind declare no performer channels. Voice belongs to chat. */
export const NO_CAPABILITIES: PerformerCapabilities = {
  posture: false,
  face: false,
  gaze: false,
  gestures: [],
  body: false,
}

/** Voice always passes. Cue gestures have their own declaration rather than inheriting posture permission. */
export function permits(capabilities: PerformerCapabilities, intent: MindIntent): boolean {
  if (intent.kind === 'gesture')
    return capabilities.gestures.includes(intent.gesture)
  if (intent.channel === 'voice')
    return true
  return capabilities[intent.channel]
}
