import type { DecodedMotionTrace } from '../read-trace'
import type { DetectorParameters, MetricResult } from './types'

import { coreMetrics } from './core'
import { emotionMetrics, emotionTrials } from './emotion'
import { gaitMetrics } from './gait'
import { gazeMetrics } from './gaze'
import { gestureMetrics } from './gesture'
import { idleMetrics } from './idle'
import { intermittencyMetrics } from './intermittency'
import { onsetMetrics } from './onset'
import { periodMetrics } from './period'
import { prepareTrace } from './prepare'
import { smoothMetrics } from './smooth'
import { spectralMetrics } from './spectral'

export { activity, coreMetrics } from './core'
export { emotionMetrics, emotionTrials } from './emotion'
export type { EmotionTrial } from './emotion'
export { gaitMetrics } from './gait'
export { gazeMetrics } from './gaze'
export { gestureMetrics } from './gesture'
export { detectorQuantities, intermittencyMetrics } from './intermittency'
export { onsetMetrics } from './onset'
export { periodMetrics } from './period'
export { prepareTrace } from './prepare'
export { smoothMetrics } from './smooth'
export { spectralMetrics } from './spectral'
export type * from './types'

/**
 * One trace -> raw core and applicable scenario measurements; no files, bands, clocks or randomness.
 * Emotion pools across clips use emotionTrials / emotionMetrics directly.
 */
export function measureTrace(input: DecodedMotionTrace, params: DetectorParameters): MetricResult[] {
  const p = prepareTrace(input)
  const metrics = [
    ...coreMetrics(p, params),
    ...periodMetrics(p),
    ...spectralMetrics(p),
    ...intermittencyMetrics(p, params.moveSpeed.body),
    ...smoothMetrics(p, params),
  ]
  const scenario = input.trace.source.scenario.class
  switch (scenario) {
    case 'idle':
      return [...metrics, ...idleMetrics(p, params)]
    case 'talk':
      return [...metrics, ...gestureMetrics(p, params), ...onsetMetrics(p, params)]
    case 'gaze':
      return [...metrics, ...gazeMetrics(p, params), ...onsetMetrics(p, params)]
    case 'emotion':
      return [...metrics, ...emotionMetrics(emotionTrials(p)), ...onsetMetrics(p, params)]
    case 'react':
      return [...metrics, ...onsetMetrics(p, params)]
    case 'walk':
      return [...metrics, ...gaitMetrics(p)]
    default: {
      const exhaustive: never = scenario
      return exhaustive
    }
  }
}
