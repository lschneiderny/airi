import type { PerformanceMode, PerformanceOverride } from '@proj-airi/stage-shared/performance-state'

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/** One emotion fired from the devtools Natural lab. */
export interface EmotionPulse {
  name: string
  intensity: number
  /** Increments per pulse. The stage enqueues a pulse when `seq` changes, so equal pulses still fire. */
  seq: number
}

/**
 * Developer control over the Natural motion driver's performance state.
 *
 * Holds only the override. The stage passes `performanceOverride` to the
 * performance resolver, which lets it replace the resolved mode, and watches
 * `emotionPulse` to push lab emotions through the real emotion queue.
 *
 * Replicated rather than persisted. The lab lives in the devtools window and the
 * character is drawn in the stage window, so the value has to cross windows;
 * surviving a restart would only leave a test override on by surprise.
 */
export const useNaturalPerformanceOverride = defineStore('natural-performance-override', () => {
  const overrideEnabled = ref(false)
  const overrideMode = ref<PerformanceMode>('idle')
  /** Energy forced on the Natural driver, 0..1, or `null` to keep the user's Energy setting. */
  const overrideEnergy = ref<number | null>(null)
  const emotionPulse = ref<EmotionPulse | null>(null)

  /**
   * What the lab is forcing, or `null` when it is off and the stage should
   * resolve the mode from the real signals.
   */
  const performanceOverride = computed<PerformanceOverride | null>(() => {
    if (!overrideEnabled.value)
      return null

    return {
      mode: overrideMode.value,
      energy: overrideEnergy.value,
    }
  })

  function pulseEmotion(name: string, intensity: number) {
    emotionPulse.value = { name, intensity, seq: (emotionPulse.value?.seq ?? 0) + 1 }
  }

  function resetState() {
    overrideEnabled.value = false
    overrideMode.value = 'idle'
    overrideEnergy.value = null
    emotionPulse.value = null
  }

  return {
    overrideEnabled,
    overrideMode,
    overrideEnergy,
    emotionPulse,
    performanceOverride,
    pulseEmotion,
    resetState,
  }
}, {
  synced: {
    state: true,
  },
})
