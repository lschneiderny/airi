import type { ExpressionPerformanceSettings } from './settings'

import { createPickerDecider } from './picker'

/** Constructs the replayable policy selected by the settings document. */
export function createDecider(_kind: ExpressionPerformanceSettings['decider']) {
  return createPickerDecider()
}
