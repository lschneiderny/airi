import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A static import keeps the cold transform of the store's module graph (about 9 s under load) out of the test timeouts.
import { useProviderStore } from '../providers/provider'
import { useSettingsAnalytics } from '../settings/analytics'
import { useHearingStore } from './hearing'

const analyticsMock = vi.hoisted(() => ({
  capture: vi.fn(),
}))

const transcriptionMock = vi.hoisted(() => ({
  generateTranscription: vi.fn(async () => ({ text: 'hello' })),
}))

vi.mock('../../composables/use-analytics', () => ({
  getConversationAnalyticsSurface: () => 'web',
  useAnalytics: () => {
    throw new Error('Must be called at the top of a setup function')
  },
}))

vi.mock('../../libs/product-signals', () => ({
  captureAnalyticsEvent: analyticsMock.capture,
  enableAnalytics: () => true,
}))

vi.mock('@xsai/generate-transcription', () => ({
  generateTranscription: transcriptionMock.generateTranscription,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en' },
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('useHearingStore analytics lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    analyticsMock.capture.mockReset()
    useSettingsAnalytics().analyticsEnabled = true
    transcriptionMock.generateTranscription.mockReset()
    transcriptionMock.generateTranscription.mockResolvedValue({ text: 'hello' })
  })

  /**
   * @example
   * await hearingStore.transcription(providerId, provider, model, file)
   */
  it('constructs hearing after provider setup and transcribes without component-only composables', async () => {
    useProviderStore()
    const hearingStore = useHearingStore()

    const result = await hearingStore.transcription(
      'openai-compatible-audio-transcription',
      {
        transcription: (model: string) => ({ baseURL: 'https://transcription.example.test/v1/', model }),
      },
      'FunAudioLLM/SenseVoiceSmall',
      new File(['hello'], 'recording.wav', { type: 'audio/wav' }),
    )

    expect(result.text).toBe('hello')
    expect(analyticsMock.capture).toHaveBeenCalledWith('voice_input_started', {
      app_surface: 'web',
      trigger_method: 'voice',
      trigger_type: 'user_action',
      stt_provider_id: 'openai-compatible-audio-transcription',
    })
    expect(analyticsMock.capture).toHaveBeenCalledWith('stt_succeeded', {
      provider: 'openai-compatible-audio-transcription',
      latency_ms: expect.any(Number),
      char_count: 5,
      stream: false,
    })
  })

  /**
   * @example
   * await expect(hearingStore.transcription(providerId, provider, model, file)).rejects.toThrow()
   */
  it('normalizes microphone permission failures for analytics', async () => {
    const hearingStore = useHearingStore()
    const permissionError = new DOMException('User denied microphone', 'NotAllowedError')
    transcriptionMock.generateTranscription.mockRejectedValueOnce(permissionError)

    await expect(hearingStore.transcription(
      'openai-compatible-audio-transcription',
      {
        transcription: (model: string) => ({ baseURL: 'https://transcription.example.test/v1/', model }),
      },
      'FunAudioLLM/SenseVoiceSmall',
      new File(['hello'], 'recording.wav', { type: 'audio/wav' }),
    )).rejects.toBe(permissionError)

    expect(analyticsMock.capture).toHaveBeenCalledWith('stt_failed', {
      provider: 'openai-compatible-audio-transcription',
      error_code: 'permission_denied',
    })
    expect(analyticsMock.capture).toHaveBeenCalledWith('microphone_permission_denied', {
      app_surface: 'web',
      trigger_method: 'voice',
      trigger_type: 'user_flow_result',
      stt_provider_id: 'openai-compatible-audio-transcription',
      error_code: 'permission_denied',
    })
  })
})
