import type { ForegroundWindowSample } from '@proj-airi/electron-eventa'

import { defineInvoke } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { electron } from '@proj-airi/electron-eventa'
import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

/** The situation reads app switches at human pace, so 1 Hz is enough and cheap for the FFI read. */
const SAMPLE_INTERVAL_MS = 1000

/**
 * Feeds the shared foreground window store from the Electron host.
 *
 * Use when:
 * - The stage window needs the foreground app for the situation sensors
 *
 * Expects:
 * - Only the main stage window starts it; follower windows never do, so one
 *   renderer polls the main process
 *
 * Returns:
 * - `start`/`stop`, both idempotent, and `polling` for diagnostics
 *
 * Unlike the desktop activity producer, polling continues while the stage
 * window is hidden or minimized: the user's foreground app matters most then.
 */
export const useForegroundWindowProducerStore = defineStore('foreground-window-producer', () => {
  const foregroundWindow = useForegroundWindowStore()

  /** Whether the 1 Hz foreground poll is running. */
  const polling = shallowRef(false)

  let timer: ReturnType<typeof setInterval> | undefined
  /** Advances whenever polling stops, so a reply that arrives later is dropped. */
  let pollGeneration = 0
  let sampleInFlight = false
  /** Logs only the first failure of a run, so a broken sampler does not log once per second. */
  let failureLogged = false

  async function sample(readForegroundWindow: () => Promise<ForegroundWindowSample | null>) {
    // A slow main process must not stack replies; the next tick tries again.
    if (sampleInFlight)
      return

    const generation = pollGeneration
    sampleInFlight = true
    try {
      const next = await readForegroundWindow()
      if (generation !== pollGeneration)
        return
      failureLogged = false
      // `null` means no window has focus or the host cannot sample. Keep the
      // last sample; its `sampledAtMs` ages and the consumers treat it as stale.
      if (next)
        foregroundWindow.setSample(next)
    }
    catch (error) {
      if (generation !== pollGeneration)
        return
      // Keep the last good sample for the same reason as a `null` reply. The
      // error comes from the main process and never carries a window title.
      if (!failureLogged) {
        failureLogged = true
        console.warn('[ForegroundWindow] Failed to sample the foreground window.', errorMessageFrom(error) ?? 'Unknown error')
      }
    }
    finally {
      if (generation === pollGeneration)
        sampleInFlight = false
    }
  }

  function start() {
    if (timer !== undefined)
      return

    const readForegroundWindow = defineInvoke(getElectronEventaContext(), electron.foregroundWindow.sample)
    polling.value = true
    void sample(readForegroundWindow)
    timer = setInterval(() => void sample(readForegroundWindow), SAMPLE_INTERVAL_MS)
  }

  function stop() {
    if (timer === undefined)
      return

    clearInterval(timer)
    timer = undefined
    pollGeneration += 1
    sampleInFlight = false
    failureLogged = false
    polling.value = false
    // Without a producer the sample only ages, and nothing would mark it stale for a new owner.
    foregroundWindow.reset()
  }

  return {
    polling,
    start,
    stop,
  }
})
