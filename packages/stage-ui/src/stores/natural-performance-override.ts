import type { BroadcastChannelEmitOptions } from '@moeru/eventa/adapters/broadcast-channel'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'
import type { IdleBehaviourKind } from '@proj-airi/motion-driver-natural/idle-activities'
import type { PerformanceMode, PerformanceOverride } from '@proj-airi/stage-shared/performance-state'

import { createContext, defineEventa } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'

/** One emotion fired from the devtools Natural lab. */
export interface EmotionPulse {
  name: string
  nominal: number
}

/** One gesture fired from the devtools Natural lab. */
export interface GestureRequest {
  kind: CueGestureKind
  count: number
}

/**
 * The lab's one-shot commands travel as events, not as replicated state, so a stage window that opens or
 * reloads after a pulse never replays it. `emit` reaches listeners in this window and in every other one.
 */
export const naturalLabEmotionPulseEvent = defineEventa<EmotionPulse>('eventa:event:natural-motion-lab:emotion-pulse')
export const naturalLabGestureEvent = defineEventa<GestureRequest>('eventa:event:natural-motion-lab:gesture')
export const naturalLabIdleEvent = defineEventa<{ kind: IdleBehaviourKind }>('eventa:event:natural-motion-lab:idle')

/**
 * Developer control over the Natural motion driver's performance state.
 *
 * The override is replicated rather than persisted. The lab lives in the devtools window and the
 * character is drawn in the stage window, so the value has to cross windows; surviving a restart would
 * only leave a test override on by surprise. The stage passes `performanceOverride` to the performance
 * resolver, which lets it replace the resolved mode.
 *
 * Emotion pulses, gesture requests and idle behaviour requests are events. The stage subscribes with
 * `onEmotionPulse`, `onGestureRequest` and `onIdleRequest` and pushes them through the real emotion queue and conductor.
 */
export const useNaturalPerformanceOverride = defineStore('natural-performance-override', () => {
  const overrideEnabled = ref(false)
  const overrideMode = ref<PerformanceMode | null>('idle')
  /** Energy forced on the Natural driver, 0..1, or `null` to keep the user's Energy setting. */
  const overrideEnergy = ref<number | null>(null)

  const channel = typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('airi-stores-stage-ui-natural-motion-lab')
  const { context, dispose } = channel
    ? createBroadcastChannelContext(channel)
    : { context: createContext<undefined, BroadcastChannelEmitOptions>(), dispose: () => {} }
  onScopeDispose(() => {
    dispose()
    channel?.close()
  })

  /**
   * What the lab is forcing, or `null` when it is off and the stage should
   * resolve the mode from the real signals.
   */
  const performanceOverride = computed<PerformanceOverride | null>(() => {
    if (!overrideEnabled.value || overrideMode.value === null)
      return null

    return {
      mode: overrideMode.value,
      energy: overrideEnergy.value,
    }
  })

  function pulseEmotion(name: string, nominal: number) {
    void context.emit(naturalLabEmotionPulseEvent, { name, nominal })
  }

  function requestGesture(kind: CueGestureKind, count: number) {
    void context.emit(naturalLabGestureEvent, { kind, count })
  }

  function requestIdle(kind: IdleBehaviourKind) {
    void context.emit(naturalLabIdleEvent, { kind })
  }

  /** Calls `handler` for each idle behaviour request from any window after this call; returns the unsubscribe. */
  function onIdleRequest(handler: (kind: IdleBehaviourKind) => void): () => void {
    return context.on(naturalLabIdleEvent, ({ body }) => {
      if (body)
        handler(body.kind)
    })
  }

  /** Calls `handler` for each pulse from any window after this call; returns the unsubscribe. */
  function onEmotionPulse(handler: (pulse: EmotionPulse) => void): () => void {
    return context.on(naturalLabEmotionPulseEvent, ({ body }) => {
      if (body)
        handler(body)
    })
  }

  /** Calls `handler` for each gesture request from any window after this call; returns the unsubscribe. */
  function onGestureRequest(handler: (request: GestureRequest) => void): () => void {
    return context.on(naturalLabGestureEvent, ({ body }) => {
      if (body)
        handler(body)
    })
  }

  function resetState() {
    overrideEnabled.value = false
    overrideMode.value = 'idle'
    overrideEnergy.value = null
  }

  return {
    overrideEnabled,
    overrideMode,
    overrideEnergy,
    performanceOverride,
    pulseEmotion,
    requestGesture,
    onEmotionPulse,
    onGestureRequest,
    requestIdle,
    onIdleRequest,
    resetState,
  }
}, {
  synced: {
    state: true,
  },
})
