import type { DesktopActivitySnapshot } from '@proj-airi/stage-shared/performance-state'
import type { EffectScope } from 'vue'

import { defineInvoke } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { electron, electronEvents } from '@proj-airi/electron-eventa'
import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useScreenAmbientLightEnvironment } from '@proj-airi/stage-shared/stores/screen-ambient-light'
import { useSystemAudioLipSyncStore } from '@proj-airi/stage-ui/stores/system-audio-lipsync'
import { defineStore } from 'pinia'
import { computed, effectScope, shallowRef, watch } from 'vue'

import { useStageWindowLifecycleStore } from './stage-window-lifecycle'

/** Idle time is whole seconds, so sampling faster than 1 Hz adds no information. */
const SAMPLE_INTERVAL_MS = 1000
/** Fast follower of the screen exposure. It tracks a cut within a frame or two. */
const SCREEN_CHANGE_FAST_TAU_SECONDS = 0.15
/** Slow follower of the screen exposure. The gap to it decays over a few seconds after a change. */
const SCREEN_CHANGE_SLOW_TAU_SECONDS = 4

/**
 * Turns the ambient-light exposure into a screen-change level.
 *
 * The level is the gap between a fast and a slow first-order follower of the
 * exposure, so a sudden change (a cut, a window switch) gives a spike that
 * relaxes over a few seconds, while a steady screen gives zero.
 */
export class ScreenChangeFollower {
  private fast = 0
  private slow = 0
  private lastMs: number | null = null

  /** Advances both followers to `nowMs` toward `exposure` (0..1) and returns the gap, 0..1. */
  update(exposure: number, nowMs: number): number {
    if (this.lastMs === null) {
      // The first exposure is the baseline, not a change.
      this.fast = exposure
      this.slow = exposure
      this.lastMs = nowMs
      return 0
    }

    const dtSeconds = Math.max(0, nowMs - this.lastMs) / 1000
    this.lastMs = Math.max(this.lastMs, nowMs)
    this.fast += (exposure - this.fast) * (1 - Math.exp(-dtSeconds / SCREEN_CHANGE_FAST_TAU_SECONDS))
    this.slow += (exposure - this.slow) * (1 - Math.exp(-dtSeconds / SCREEN_CHANGE_SLOW_TAU_SECONDS))
    return Math.min(1, Math.abs(this.fast - this.slow))
  }

  reset(): void {
    this.lastMs = null
  }
}

/**
 * Feeds the shared desktop activity store from the Electron host.
 *
 * Use when:
 * - The stage window needs desktop signals for the performance resolver
 *
 * Expects:
 * - The window lifecycle bridge is initialized, so visibility is known
 * - System-audio lipsync and screen ambient light are started elsewhere; this
 *   store only reads them while they already run and never starts a capture
 *
 * Returns:
 * - `start`/`stop`, both idempotent, and `polling` for diagnostics
 */
export const useDesktopActivityProducerStore = defineStore('desktop-activity-producer', () => {
  const desktopActivity = useDesktopActivityStore()
  const windowLifecycle = useStageWindowLifecycleStore()
  const systemAudio = useSystemAudioLipSyncStore()
  const ambientLight = useScreenAmbientLightEnvironment()

  /** Whether the 1 Hz idle-time poll is running. */
  const polling = shallowRef(false)

  const stageVisible = computed(() => windowLifecycle.windowLifecycle.visible && !windowLifecycle.windowLifecycle.minimized)

  let scope: EffectScope | undefined
  let offEvents: Array<() => void> = []
  let timer: ReturnType<typeof setInterval> | undefined
  /** Advances whenever polling stops, so a reply that arrives later is dropped. */
  let pollGeneration = 0
  let sampleInFlight = false

  let idleSeconds: number | null = null
  let locked = false
  let suspendedAtMs: number | null = null
  let resumedAtMs: number | null = null
  let unlockedAtMs: number | null = null
  const screenChangeFollower = new ScreenChangeFollower()
  let screenChange: number | null = null

  function updateScreenChange(nowMs: number) {
    screenChange = ambientLight.active
      ? screenChangeFollower.update(ambientLight.environment.exposure, nowMs)
      : null
  }

  function publish() {
    const nowMs = Date.now()
    updateScreenChange(nowMs)
    const snapshot: DesktopActivitySnapshot = {
      idleSeconds,
      locked,
      suspendedAtMs,
      resumedAtMs,
      unlockedAtMs,
      systemAudioLevel: systemAudio.isActive ? systemAudio.inputLevel : null,
      screenChange,
      sampledAtMs: nowMs,
    }
    desktopActivity.setSnapshot(snapshot)
  }

  async function sample(getSystemIdleTime: () => Promise<number>) {
    // A slow main process must not stack replies; the next tick tries again.
    if (sampleInFlight)
      return

    const generation = pollGeneration
    sampleInFlight = true
    try {
      const seconds = await getSystemIdleTime()
      if (generation !== pollGeneration)
        return
      idleSeconds = Number.isFinite(seconds) && seconds >= 0 ? seconds : null
    }
    catch (error) {
      if (generation !== pollGeneration)
        return
      // An unknown idle time is `null`, never activity, so the resolver stays safe.
      idleSeconds = null
      console.warn('[DesktopActivity] Failed to read the system idle time.', errorMessageFrom(error) ?? 'Unknown error')
    }
    finally {
      sampleInFlight = false
    }
    publish()
  }

  function stopPolling() {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
    pollGeneration += 1
    sampleInFlight = false
    polling.value = false
  }

  function startPolling(getSystemIdleTime: () => Promise<number>) {
    if (timer !== undefined)
      return

    polling.value = true
    // The performance resolver takes the first snapshot as its wake baseline,
    // so publish it now instead of one interval later.
    void sample(getSystemIdleTime)
    timer = setInterval(() => void sample(getSystemIdleTime), SAMPLE_INTERVAL_MS)
  }

  function start() {
    if (scope)
      return

    const context = getElectronEventaContext()
    const getSystemIdleTime = defineInvoke(context, electron.powerMonitor.getSystemIdleTime)

    offEvents = [
      context.on(electronEvents.powerMonitor.lockScreen, () => {
        locked = true
        publish()
      }),
      context.on(electronEvents.powerMonitor.unlockScreen, () => {
        locked = false
        unlockedAtMs = Date.now()
        publish()
      }),
      context.on(electronEvents.powerMonitor.suspended, () => {
        suspendedAtMs = Date.now()
        publish()
      }),
      context.on(electronEvents.powerMonitor.resumed, () => {
        resumedAtMs = Date.now()
        publish()
      }),
    ]

    scope = effectScope(true)
    scope.run(() => {
      watch(stageVisible, (visible) => {
        if (visible)
          startPolling(getSystemIdleTime)
        else
          stopPolling()
      }, { immediate: true })

      // Advance the followers on every capture, not only at 1 Hz, so a short
      // cut is measured at the capture rate.
      watch(() => ambientLight.environment, () => {
        if (ambientLight.active)
          updateScreenChange(Date.now())
      })
      watch(() => ambientLight.active, (active) => {
        if (!active) {
          screenChangeFollower.reset()
          screenChange = null
        }
      })
    })
  }

  function stop() {
    if (!scope)
      return

    stopPolling()
    scope.stop()
    scope = undefined
    for (const off of offEvents)
      off()
    offEvents = []
    screenChangeFollower.reset()
    screenChange = null
    idleSeconds = null
    locked = false
    suspendedAtMs = null
    resumedAtMs = null
    unlockedAtMs = null
    // Without a producer the samples go stale, and a stale sample would read as live data.
    desktopActivity.reset()
  }

  return {
    polling,
    start,
    stop,
  }
})
