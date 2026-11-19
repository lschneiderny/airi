import type { HostDataDeletion } from '@proj-airi/stage-ui/composables/host-data-deletion'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

import { homeAssistantSetConfig } from '../../shared/eventa/home-assistant'
import { storedDataDeleteActivity } from '../../shared/eventa/stored-data'

/**
 * The host step of "Delete all data" for what the main process owns: the Home Assistant address and token, session
 * logs, IO traces, and computer-use captures.
 */
export function createMainProcessDataDeletion(): HostDataDeletion {
  const setHomeAssistantConfig = useElectronEventaInvoke(homeAssistantSetConfig)
  const deleteActivityRecords = useElectronEventaInvoke(storedDataDeleteActivity)
  return async () => {
    // An empty address clears the stored token with it.
    await setHomeAssistantConfig({ baseUrl: '' })
    await deleteActivityRecords()
  }
}
