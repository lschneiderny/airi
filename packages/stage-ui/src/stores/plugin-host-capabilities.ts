import { isStageTamagotchi } from '@proj-airi/stage-shared'

import { listProviders } from '../libs/providers/providers'

export interface PluginHostProviderSummary {
  name: string
}

export function listProvidersForPluginHost(): PluginHostProviderSummary[] {
  return listProviders()
    .filter(provider => provider.configuredBy !== 'authentication')
    .map(provider => ({ name: provider.name }))
}

export function shouldPublishPluginHostCapabilities() {
  return isStageTamagotchi()
}
