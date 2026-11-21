import type { HostDataDeletion } from '@proj-airi/stage-ui/composables/host-data-deletion'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

import { electronApplyServerChannelConfig } from '../../shared/eventa'
import { homeAssistantSetConfig } from '../../shared/eventa/home-assistant'
import { goClearConfigurations } from '../../shared/eventa/opencode-go'
import { storedDataDeleteActivity } from '../../shared/eventa/stored-data'
import { useServerChannelSettingsStore } from '../stores/settings/server-channel'

/**
 * The host step of "Delete all data" for what the main process owns: the Home Assistant address and token, the
 * desktop server channel's address and token, the OpenCode Go keys, session logs, IO traces, and computer-use captures.
 */
export function createMainProcessDataDeletion(): HostDataDeletion {
  const setHomeAssistantConfig = useElectronEventaInvoke(homeAssistantSetConfig)
  const applyServerChannelConfig = useElectronEventaInvoke(electronApplyServerChannelConfig)
  const clearGoConfigurations = useElectronEventaInvoke(goClearConfigurations)
  const deleteActivityRecords = useElectronEventaInvoke(storedDataDeleteActivity)
  return async () => {
    // An empty address clears the stored token with it.
    await setHomeAssistantConfig({ baseUrl: '' })
    // An empty token makes the main process generate a new one, so the old token no longer opens the channel. This
    // window's settings then read the new config, so a later edit here cannot apply the old token again.
    await applyServerChannelConfig({ tlsConfig: null, hostname: '127.0.0.1', authToken: '' })
    await useServerChannelSettingsStore().refreshServerChannelConfig()
    await clearGoConfigurations()
    await deleteActivityRecords()
  }
}
