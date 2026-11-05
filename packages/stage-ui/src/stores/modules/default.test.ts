import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'
import { useConsciousnessStore } from './consciousness'
import { initialize, retiredProviderIds } from './default'
import { useHearingStore } from './hearing'
import { useSpeechStore } from './speech'
import { useVisionStore } from './vision'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'en-US' }, t: (key: string) => key }),
}))

vi.mock('../../composables/use-analytics', () => ({
  useAnalytics: () => ({
    trackAudioDeviceUnavailable: vi.fn(),
    trackMicrophonePermissionDenied: vi.fn(),
    trackSttFailed: vi.fn(),
    trackSttStarted: vi.fn(),
    trackSttSucceeded: vi.fn(),
    trackVoiceInputStarted: vi.fn(),
  }),
}))

describe('account-free module defaults', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads saved retired selections without throwing and is idempotent', async () => {
    const providers = useProviderConfigStore()
    const runtime = useProviderStore()
    for (const id of retiredProviderIds) {
      providers.providers[id] = { id, definitionId: id, config: {}, status: 'configured', configuredBy: 'authentication' }
      providers.addedProviders[id] = true
      runtime.providerRuntimeState[id] = { models: [], defaultModel: null, modelStatus: 'idle', modelError: null }
    }
    providers.providers['saved-instance'] = {
      id: 'saved-instance',
      definitionId: 'official-provider',
      config: {},
      status: 'configured',
      configuredBy: 'authentication',
    }
    const consciousness = useConsciousnessStore()
    const hearing = useHearingStore()
    const speech = useSpeechStore()
    const vision = useVisionStore()
    consciousness.activeProvider = 'saved-instance'
    consciousness.activeModel = 'auto'
    consciousness.customModelName = 'old'
    hearing.activeTranscriptionProvider = 'official-provider-transcription'
    hearing.activeTranscriptionModel = 'auto'
    speech.activeSpeechProvider = 'official-provider-speech-streaming'
    speech.activeSpeechModel = 'auto'
    speech.activeSpeechVoiceId = 'old'
    vision.activeProvider = 'vision-official-provider'
    vision.activeModel = 'auto'

    await expect(initialize()).resolves.toBe(true)

    expect([consciousness.activeProvider, consciousness.activeModel, consciousness.customModelName]).toEqual(['', '', ''])
    expect([hearing.activeTranscriptionProvider, hearing.activeTranscriptionModel]).toEqual(['', ''])
    expect([speech.activeSpeechProvider, speech.activeSpeechModel, speech.activeSpeechVoiceId]).toEqual(['speech-noop', '', ''])
    expect([vision.activeProvider, vision.activeModel]).toEqual(['', ''])
    expect(providers.providers).toEqual({})
    expect(providers.addedProviders).toEqual({})
    expect(runtime.providerRuntimeState).toEqual({})
    await expect(initialize()).resolves.toBe(false)
  })

  it('preserves direct providers and explicit module selections', async () => {
    const providers = useProviderConfigStore()
    providers.ensureProvider('openai-compatible', 'openai-compatible', { apiKey: 'direct-key' })
    const consciousness = useConsciousnessStore()
    consciousness.activeProvider = 'openai-compatible'
    consciousness.activeModel = 'chosen-model'
    const speech = useSpeechStore()
    speech.activeSpeechProvider = 'openai-compatible-audio-speech'
    speech.activeSpeechModel = 'chosen-speech'
    speech.activeSpeechVoiceId = 'chosen-voice'

    await expect(initialize()).resolves.toBe(false)

    expect(consciousness.activeProvider).toBe('openai-compatible')
    expect(consciousness.activeModel).toBe('chosen-model')
    expect(speech.activeSpeechVoiceId).toBe('chosen-voice')
    expect(providers.getProviderConfig('openai-compatible')).toEqual({ apiKey: 'direct-key' })
  })

  it('clears stale child selections when their provider is empty', async () => {
    const consciousness = useConsciousnessStore()
    consciousness.customModelName = 'old-model'
    const hearing = useHearingStore()
    hearing.activeTranscriptionModel = 'old-model'
    const speech = useSpeechStore()
    speech.activeSpeechModel = 'old-model'
    speech.activeSpeechVoiceId = 'old-voice'

    await expect(initialize()).resolves.toBe(true)
    expect(consciousness.customModelName).toBe('')
    expect(hearing.activeTranscriptionModel).toBe('')
    expect(speech.activeSpeechProvider).toBe('speech-noop')
    expect(speech.activeSpeechModel).toBe('')
    expect(speech.activeSpeechVoiceId).toBe('')
    await expect(initialize()).resolves.toBe(false)
  })
})
