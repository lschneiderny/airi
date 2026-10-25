import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

/**
 * Host-neutral reading of the desktop window that has keyboard focus.
 *
 * The Electron host writes `ForegroundWindowSample` from `@proj-airi/electron-eventa`,
 * which must stay assignable to this shape; the producer's `setSample` call checks that.
 */
export interface ForegroundWindowSample {
  /** Full image path of the owning process, or `null` when the host cannot read it. */
  exePath: string | null
  /** File name of `exePath` with its original casing, for example `Notepad.exe`. */
  exeName: string | null
  /** Raw window title; empty when the window has none. Never persist or log it. */
  title: string
  pid: number
  /** `true` when the window belongs to one of AIRI's own processes. */
  ownProcess: boolean
  /**
   * What the host can say about whether a remark fits now.
   * Each host maps its own OS states before they cross IPC; `null` means this host could not tell.
   */
  busy: 'accepts' | 'busy' | 'fullscreen' | 'presentation' | 'quiet' | null
  /** Host `Date.now()` at the time of the reading. */
  sampledAtMs: number
}

/**
 * Holds the latest foreground window sample for the situation sensors.
 *
 * The host writes it: Electron's stage window polls the main process, and the
 * web host never writes one, so `sample` stays `null` and the sensors treat the
 * foreground app as unknown. A failed or empty reading leaves the previous
 * sample in place with its old `sampledAtMs`, so consumers judge freshness from
 * that timestamp. Runtime state only; it is neither persisted nor replicated,
 * because the sample carries a raw window title.
 */
export const useForegroundWindowStore = defineStore('foreground-window', () => {
  const sample = shallowRef<ForegroundWindowSample | null>(null)

  function setSample(next: ForegroundWindowSample) {
    sample.value = next
  }

  function reset() {
    sample.value = null
  }

  return {
    sample,
    setSample,
    reset,
  }
})
