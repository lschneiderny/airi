import type { PerformerCapabilities } from '../capabilities'
import type { MindSlowState } from '../types'

import { initialMindState } from '../step'

/** A renderer-neutral performer that realises every channel for the existing policy regressions. */
export const allCapabilities: PerformerCapabilities = {
  posture: true,
  face: true,
  gaze: true,
  gestures: ['nod', 'shake', 'glance', 'shrug', 'lean'],
  body: true,
}

export function naturalMindState(slow?: MindSlowState) {
  return { ...initialMindState(slow), performer: allCapabilities }
}
