import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import { useLocalStorageManualReset, useVersionedLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { clamp, isPlainObject } from 'es-toolkit'
import { defineStore } from 'pinia'

export type Live2DMotionDriver = 'magic' | 'natural' | 'universal'
/** Natural strength per emotion, by stage model id. A missing model or emotion means 1. */
export type Live2DNaturalEmotionStrengths = Record<string, Partial<Record<PerformanceEmotion, number>>>

const live2dMotionDriver = useLocalStorageManualReset<Live2DMotionDriver>('settings/live2d/motion-driver', 'universal')
const live2dEyeTracking = useLocalStorageManualReset<boolean>('settings/live2d/eye-tracking', true)
const live2dNaturalCursorAttention = useLocalStorageManualReset<boolean>('settings/live2d/natural-cursor-attention', true)
/** Let the user poke the model and pet its head with the cursor while Natural drives it. */
const live2dNaturalTouch = useLocalStorageManualReset<boolean>('settings/live2d/natural-touch', true)
/** Count only strokes made with the primary button held as pets, so passing the cursor over the head never pets it. */
const live2dNaturalTouchPetRequiresHold = useLocalStorageManualReset<boolean>('settings/live2d/natural-touch-pet-requires-hold', false)
/**
 * Size of the petting area relative to the measured head, by stage model id. A model
 * without an entry uses 1, the measured head. Replace the record on write; consumers
 * watch it by identity.
 */
const live2dNaturalTouchHeadScale = useLocalStorageManualReset<Record<string, number>>('settings/live2d/natural-touch-head-scale', {})
const naturalEmotionStrengthMax = 2
/**
 * localStorage is outside the app's control, so a stored entry that is not a
 * finite number is dropped on read, an out-of-range one is clamped, and a model
 * left without entries is dropped with it.
 */
function readNaturalEmotionStrengths(raw: string): Live2DNaturalEmotionStrengths {
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  }
  catch {
    return {}
  }
  if (!isPlainObject(stored))
    return {}

  const strengths: Live2DNaturalEmotionStrengths = {}
  for (const [modelId, entry] of Object.entries(stored)) {
    if (!isPlainObject(entry))
      continue
    const values = Object.entries(entry)
      .flatMap(([emotion, value]) => typeof value === 'number' && Number.isFinite(value) ? [[emotion, clamp(value, 0, naturalEmotionStrengthMax)] as const] : [])
    if (values.length > 0)
      strengths[modelId] = Object.fromEntries(values)
  }
  return strengths
}
/**
 * How strongly Natural performs each emotion for a stage model, from 0 (that
 * emotion is not performed) to 2. Replace the record on write; consumers watch
 * it by identity.
 */
const live2dNaturalEmotionStrength = useLocalStorageManualReset<Live2DNaturalEmotionStrengths>('settings/live2d/natural-emotion-strength', {}, {
  serializer: {
    read: readNaturalEmotionStrengths,
    write: value => JSON.stringify(value),
  },
})
const naturalEnergyDefault = 0.5
/**
 * How lively Natural motion is, from 0 (calm) to 1 (energetic). The motion
 * driver reads it as a plain number, and localStorage is outside the app's
 * control, so an unparsable stored value falls back to the default and an
 * out-of-range one is clamped on read.
 */
const live2dNaturalEnergy = useLocalStorageManualReset<number>('settings/live2d/natural-energy', naturalEnergyDefault, {
  serializer: {
    read: (raw) => {
      const value = Number.parseFloat(raw)
      return Number.isFinite(value) ? clamp(value, 0, 1) : naturalEnergyDefault
    },
    write: value => String(value),
  },
})
/** Offset from model center to the eyes of the model, in percentages of full model width/height */
const live2dModelEyeOffset = useLocalStorageManualReset('settings/live2d/model-eye-offset', { x: 0, y: 0 })
const live2dIdleAnimationEnabled = useLocalStorageManualReset<boolean>('settings/live2d/idle-animation-enabled', true)
/** Let the avatar look around while no cursor tracking source is active. */
const live2dForceIdleEyeAnimation = useLocalStorageManualReset<boolean>('settings/live2d/idle-eye-animation-enabled', true)
const live2dAutoBlinkEnabled = useVersionedLocalStorageManualReset<boolean>('settings/live2d/auto-blink-enabled', true, {
  defaultVersion: '2.0.0',
  satisfiesVersionBy(beforeVersion, afterVersion) {
    if (beforeVersion === afterVersion) {
      return true
    }

    return false
  },
})
const live2dForceAutoBlinkEnabled = useVersionedLocalStorageManualReset<boolean>('settings/live2d/force-auto-blink-enabled', true, {
  defaultVersion: '2.0.0',
  satisfiesVersionBy(beforeVersion, afterVersion) {
    if (beforeVersion === afterVersion) {
      return true
    }

    return false
  },
})
const live2dExpressionEnabled = useLocalStorageManualReset<boolean>('settings/live2d/expression-enabled', true)
const live2dShadowEnabled = useLocalStorageManualReset<boolean>('settings/live2d/shadow-enabled', true)
const live2dMaxFps = useLocalStorageManualReset<number>('settings/live2d/max-fps', 60)
const live2dRenderScale = useLocalStorageManualReset<number>('settings/live2d/render-scale', 2)

function resetState() {
  live2dMotionDriver.reset()
  live2dEyeTracking.reset()
  live2dNaturalCursorAttention.reset()
  live2dNaturalTouch.reset()
  live2dNaturalTouchPetRequiresHold.reset()
  live2dNaturalTouchHeadScale.reset()
  live2dNaturalEmotionStrength.reset()
  live2dNaturalEnergy.reset()
  live2dModelEyeOffset.reset()
  live2dIdleAnimationEnabled.reset()
  live2dForceIdleEyeAnimation.reset()
  live2dAutoBlinkEnabled.reset()
  live2dForceAutoBlinkEnabled.reset()
  live2dExpressionEnabled.reset()
  live2dShadowEnabled.reset()
  live2dMaxFps.reset()
  live2dRenderScale.reset()
}

export const useSettingsLive2d = defineStore('settings-live2d', () => {
  return {
    live2dMotionDriver,
    live2dEyeTracking,
    live2dNaturalCursorAttention,
    live2dNaturalTouch,
    live2dNaturalTouchPetRequiresHold,
    live2dNaturalTouchHeadScale,
    live2dNaturalEmotionStrength,
    live2dNaturalEnergy,
    live2dModelEyeOffset,
    live2dIdleAnimationEnabled,
    live2dForceIdleEyeAnimation,
    live2dAutoBlinkEnabled,
    live2dForceAutoBlinkEnabled,
    live2dExpressionEnabled,
    live2dShadowEnabled,
    live2dMaxFps,
    live2dRenderScale,
    resetState,
  }
})
