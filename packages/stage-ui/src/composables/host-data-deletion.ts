import type { InjectionKey } from 'vue'

import { inject } from 'vue'

/** Deletes what the host keeps outside the renderer's storage, such as files its main process wrote. */
export type HostDataDeletion = () => Promise<void>

/**
 * The host step of "Delete all data". The host provides it once at the app level, so the Data settings page and the
 * QA bridge run the same step. A host without data outside the renderer (web) provides nothing.
 *
 * This module does not import the stores, so the host app entry can provide the step cheaply.
 */
export const hostDataDeletionKey: InjectionKey<HostDataDeletion> = Symbol('@proj-airi/stage-ui/host-data-deletion')

/** Reads the host step. Call it in a component setup that the host app renders, so the injection resolves. */
export function useHostDataDeletion(): HostDataDeletion | undefined {
  return inject(hostDataDeletionKey, undefined)
}
