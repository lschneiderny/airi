import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@proj-airi/stage-shared/composables', () => {
  function useLocalStorageManualReset<T>(_key: string, initialValue: T) {
    const state = ref(initialValue)
    return Object.assign(state, {
      reset: () => {
        state.value = initialValue
      },
    })
  }

  return {
    useLocalStorageManualReset,
    useVersionedLocalStorageManualReset: useLocalStorageManualReset,
  }
})

describe('useSettingsLive2d', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
  })

  it('defaults the motion driver to Universal', async () => {
    const { useSettingsLive2d } = await import('./live2d')

    const settings = useSettingsLive2d()

    expect(settings.live2dMotionDriver).toBe('universal')
    expect(settings.live2dNaturalCursorAttention).toBe(true)
  })

  it('resets Natural and Universal preferences independently', async () => {
    const { useSettingsLive2d } = await import('./live2d')
    const settings = useSettingsLive2d()

    settings.live2dMotionDriver = 'natural'
    settings.live2dNaturalCursorAttention = false
    expect(settings.live2dEyeTracking).toBe(true)
    settings.live2dEyeTracking = false
    settings.live2dNaturalCursorAttention = true
    expect(settings.live2dEyeTracking).toBe(false)
    settings.live2dNaturalCursorAttention = false
    settings.live2dForceIdleEyeAnimation = false
    settings.live2dIdleAnimationEnabled = false
    settings.resetState()

    expect(settings.live2dMotionDriver).toBe('universal')
    expect(settings.live2dNaturalCursorAttention).toBe(true)
    expect(settings.live2dEyeTracking).toBe(true)
    expect(settings.live2dForceIdleEyeAnimation).toBe(true)
    expect(settings.live2dIdleAnimationEnabled).toBe(true)
  })

  it('defaults Natural energy to 0.5 and restores it on reset', async () => {
    const { useSettingsLive2d } = await import('./live2d')

    const settings = useSettingsLive2d()

    expect(settings.live2dNaturalEnergy).toBe(0.5)
    settings.live2dNaturalEnergy = 1
    settings.resetState()
    expect(settings.live2dNaturalEnergy).toBe(0.5)
  })

  /**
   * @example
   * expect(settings.live2dEyeTracking).toBe(true)
   */
  it('defaults mouse tracking to enabled to preserve the old focus behavior', async () => {
    const { useSettingsLive2d } = await import('./live2d')

    const settings = useSettingsLive2d()

    expect(settings.live2dEyeTracking).toBe(true)
  })

  /**
   * @example
   * expect(settings.live2dForceIdleEyeAnimation).toBe(true)
   */
  it('defaults idle eye animation to enabled to preserve no-cursor idle behavior', async () => {
    const { useSettingsLive2d } = await import('./live2d')

    const settings = useSettingsLive2d()

    expect(settings.live2dForceIdleEyeAnimation).toBe(true)
  })

  /**
   * @example
   * expect(settings.live2dAutoBlinkEnabled).toBe(true)
   */
  it('defaults blink to enabled with forced blink mode', async () => {
    const { useSettingsLive2d } = await import('./live2d')

    const settings = useSettingsLive2d()

    expect(settings.live2dAutoBlinkEnabled).toBe(true)
    expect(settings.live2dForceAutoBlinkEnabled).toBe(true)
  })
})
