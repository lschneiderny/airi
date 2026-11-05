import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'
import { useConsciousnessStore } from './consciousness'
import { useHearingStore } from './hearing'
import { useSpeechStore } from './speech'
import { useVisionStore } from './vision'

// NOTICE:
// Saved settings can still refer to the retired account-backed providers.
// The account-free fork no longer registers their definitions or transports.
// Source: docs/ai/audits/2026-10-31-architecture-boundaries.md, H3.
// Remove this cleanup when saved settings from hosted-provider versions are no longer supported.
export const retiredProviderIds: ReadonlySet<string> = new Set([
  'official-provider',
  'official-provider-speech',
  'official-provider-speech-streaming',
  'official-provider-transcription',
  'vision-official-provider',
])

/** Applies account-free defaults and removes retired providers before card startup. The caller owns Pinia leadership. */
export async function initialize(): Promise<boolean> {
  const consciousness = useConsciousnessStore()
  const hearing = useHearingStore()
  const speech = useSpeechStore()
  const vision = useVisionStore()
  const providers = useProviderConfigStore()
  const runtime = useProviderStore()
  const removed = new Set(retiredProviderIds)
  for (const provider of Object.values(providers.providers)) {
    if (retiredProviderIds.has(provider.definitionId))
      removed.add(provider.id)
  }

  let changed = false
  if ((!consciousness.activeProvider || removed.has(consciousness.activeProvider))
    && (consciousness.activeProvider || consciousness.activeModel || consciousness.customModelName)) {
    consciousness.activeProvider = ''
    consciousness.activeModel = ''
    consciousness.customModelName = ''
    changed = true
  }
  if ((!hearing.activeTranscriptionProvider || removed.has(hearing.activeTranscriptionProvider))
    && (hearing.activeTranscriptionProvider || hearing.activeTranscriptionModel || hearing.activeCustomModelName)) {
    hearing.activeTranscriptionProvider = ''
    hearing.activeTranscriptionModel = ''
    hearing.activeCustomModelName = ''
    changed = true
  }
  if ((!speech.activeSpeechProvider || speech.activeSpeechProvider === 'speech-noop' || removed.has(speech.activeSpeechProvider))
    && (speech.activeSpeechProvider !== 'speech-noop' || speech.activeSpeechModel || speech.activeSpeechVoiceId || speech.activeSpeechVoice)) {
    speech.activeSpeechProvider = 'speech-noop'
    speech.activeSpeechModel = ''
    speech.activeSpeechVoiceId = ''
    speech.activeSpeechVoice = undefined
    changed = true
  }
  if ((!vision.activeProvider || removed.has(vision.activeProvider))
    && (vision.activeProvider || vision.activeModel || vision.customModelName)) {
    vision.activeProvider = ''
    vision.activeModel = ''
    vision.customModelName = ''
    changed = true
  }

  for (const id of removed) {
    if (providers.providers[id] || providers.addedProviders[id] || runtime.providerRuntimeState[id])
      changed = true
    await runtime.deleteProvider(id)
  }
  return changed
}
