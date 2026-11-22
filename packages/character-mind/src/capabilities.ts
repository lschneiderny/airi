import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'

import type { MindAnswer, MindIntent, MindState } from './types'

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

/** Rejects a policy before it spends a draw or changes episode state. */
export function refusedAnswer(state: MindState, cause: number, kind: MindIntent['kind']): MindAnswer {
  return { state, intents: [], refusals: [{ cause, kind, reason: 'undeclared' }] }
}

/** Separates deterministic answers by channel. Random policies check permission before drawing. */
export function declaredAnswer(answer: MindAnswer): MindAnswer {
  const intents: MindIntent[] = []
  const refusals = [...answer.refusals ?? []]
  for (const intent of answer.intents) {
    if (permits(answer.state.performer, intent))
      intents.push(intent)
    else
      refusals.push({ cause: intent.cause, kind: intent.kind, reason: 'undeclared' })
  }
  return { ...answer, intents, refusals }
}
