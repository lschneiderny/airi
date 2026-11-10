import { useLocalStorageManualReset, useVersionedLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

export type Live2DMotionDriver = 'magic' | 'natural' | 'universal'

const live2dMotionDriver = useLocalStorageManualReset<Live2DMotionDriver>('settings/live2d/motion-driver', 'universal')
const live2dEyeTracking = useLocalStorageManualReset<boolean>('settings/live2d/eye-tracking', true)
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

/**
 * Resets the plain Live2D settings of this window. The Natural settings are a separate synced document
 * (`useLive2DNaturalSettings`); reset them with its leader-routed `reset`.
 */
function resetState() {
  live2dMotionDriver.reset()
  live2dEyeTracking.reset()
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
  /**
   * Whether the expression system runs. The Natural driver always runs it, because its eyelid and
   * expression ownership assume it; `live2dExpressionEnabled` applies only to Universal and MAGIC.
   */
  const live2dExpressionActive = computed(() => live2dExpressionEnabled.value || live2dMotionDriver.value === 'natural')

  return {
    live2dExpressionActive,
    live2dMotionDriver,
    live2dEyeTracking,
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
