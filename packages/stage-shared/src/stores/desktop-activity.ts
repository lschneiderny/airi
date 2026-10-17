import type { DesktopActivitySnapshot } from '../performance-state'

import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

/**
 * Holds the latest desktop activity sample for the stage's performance resolver.
 *
 * The host writes it: Electron forwards samples from the main process, and the
 * web host never writes one, so `snapshot` stays `null` and the resolver treats
 * every desktop signal as unknown. Runtime state only; it is neither persisted
 * nor replicated, because each renderer reads its own host's samples.
 */
export const useDesktopActivityStore = defineStore('desktop-activity', () => {
  const snapshot = shallowRef<DesktopActivitySnapshot | null>(null)

  function setSnapshot(next: DesktopActivitySnapshot) {
    snapshot.value = next
  }

  function reset() {
    snapshot.value = null
  }

  return {
    snapshot,
    setSnapshot,
    reset,
  }
})
