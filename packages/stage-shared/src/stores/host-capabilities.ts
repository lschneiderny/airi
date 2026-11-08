import type { HostCapabilities, HostSignal, SignalStatus } from '../host-capabilities'

import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

/**
 * Holds this window's latest host capability snapshot.
 *
 * The host writes it: Electron forwards the main process snapshot, and the web
 * host writes its own resolved profile. Until a host writes one, `snapshot`
 * stays `null` and `status` reports every signal as unknown. Per-window
 * runtime memory (persistence tier 6): it is neither persisted nor replicated.
 */
export const useHostCapabilitiesStore = defineStore('host-capabilities', () => {
  const snapshot = shallowRef<HostCapabilities | null>(null)

  function set(next: HostCapabilities) {
    snapshot.value = next
  }

  function reset() {
    snapshot.value = null
  }

  function status(signal: HostSignal): SignalStatus | null {
    return snapshot.value?.signals[signal] ?? null
  }

  return {
    snapshot,
    set,
    reset,
    status,
  }
})
