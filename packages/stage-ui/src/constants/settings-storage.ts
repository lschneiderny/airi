/** Persisted settings owned by their stores. Profile seeders must write these before reloading the renderer. */
export const providerStorageKeys = {
  configured: 'settings/providers/configured',
  added: 'settings/providers/added',
} as const

export const consciousnessStorageKeys = {
  provider: 'settings/consciousness/active-provider',
  model: 'settings/consciousness/active-model',
  customModel: 'settings/consciousness/active-custom-model',
} as const

export const speechStorageKeys = {
  provider: 'settings/speech/active-provider',
  model: 'settings/speech/active-model',
  voice: 'settings/speech/voice',
  enabled: 'settings/speech/enabled',
  ssml: 'settings/speech/ssml-enabled',
} as const
