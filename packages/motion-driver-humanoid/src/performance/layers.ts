import type { BodyRigTraits } from './contracts'
import type { PerformanceLayer } from './stack'

import { createActLayer } from './acts'
import { createCueLayer } from './cues'
import { createEmotionLayer } from './emotions'
import { createGestureLayers } from './gestures'
import { createReactionLayer } from './reactions'

export interface PerformanceLayerOptions {
  readonly traits: BodyRigTraits
  readonly seed: number
}

/**
 * Every whole-body performance layer a host registers with `createBodyPerformer` (architecture 3g): the emotion
 * posture, the idle act, the co-speech gesture pair, the cue gestures and the touch reactions. Without speech, emotion,
 * idle behaviour, cue, touch or arm-form input every layer stays at weight 0 and the performer's output is
 * bit-identical to having none.
 */
export function createPerformanceLayers(options: PerformanceLayerOptions): readonly PerformanceLayer[] {
  return [createEmotionLayer(), createActLayer({ seed: options.seed }), ...createGestureLayers(options), createCueLayer(), createReactionLayer()]
}
