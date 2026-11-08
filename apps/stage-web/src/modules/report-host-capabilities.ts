import type { Pinia } from 'pinia'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'

/**
 * Writes the web host capability snapshot into this window's store.
 *
 * Call once after Pinia is installed and before the app mounts, so every route sees the snapshot.
 */
export function reportWebHostCapabilities(pinia: Pinia) {
  useHostCapabilitiesStore(pinia).set(capabilitiesForHost('web'))
}
