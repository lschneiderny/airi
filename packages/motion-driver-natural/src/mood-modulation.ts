import type { ExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

import type { NaturalMood } from './mood'

export interface ModulatedScales {
  amplitudeScale: number
  shiftRateScale: number
  cameraFixationProbability: number
  emphasisAcceptance: number
}

type MoodReading = Pick<NaturalMood, 'active' | 'valence' | 'arousal' | 'tension'>

/** Scales posture, shift rate, camera probability, and emphasis acceptance by the mood afterglow; unchanged when mood is off or at rest. */
export function modulateByMood(base: ModulatedScales, mood: MoodReading, performanceSettings: ExpressionPerformanceSettings): ModulatedScales {
  const scales = { ...base }
  if (performanceSettings.mood && mood.active) {
    const settings = performanceSettings.moodDynamics
    scales.amplitudeScale *= Math.max(0.8, Math.min(1.2, 1 + settings.amplitude * mood.arousal))
    scales.shiftRateScale *= Math.max(0.7, Math.min(1.3, 1 + settings.shiftRate * mood.arousal))
    scales.cameraFixationProbability = Math.max(0, Math.min(1, scales.cameraFixationProbability + settings.cameraValence * mood.valence - settings.cameraTension * mood.tension))
    scales.emphasisAcceptance = Math.max(0, Math.min(1, scales.emphasisAcceptance + settings.emphasis * mood.arousal))
  }
  return scales
}

/** The mood afterglow's mouth form offset; zero when mood is off or at rest. */
export function moodMouthForm(mood: MoodReading, performanceSettings: ExpressionPerformanceSettings): number {
  return performanceSettings.mood && mood.active ? performanceSettings.moodDynamics.mouthForm * mood.valence : 0
}
