import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { getSpeechBusContext, speechInputUserSpeakingChangedEvent } from '../services/speech/bus'
import { useHearingStore } from './modules/hearing'
import { useSettingsAudioDevice } from './settings/audio-device'
import { useVoiceStore } from './voice'

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  localStorage.clear()
})

/** Mounts the voice store on the browser microphone adapter and records the user speech changes it sends on the speech bus. */
function mountVoice() {
  const pinia = createPinia()
  let voice!: ReturnType<typeof useVoiceStore>
  let devices!: ReturnType<typeof useSettingsAudioDevice>
  const app = createApp(defineComponent({ setup() {
    // A capture needs a transcriber; Web Speech needs no credentials, and the input is cancelled before it would send.
    useHearingStore().activeTranscriptionProvider = 'browser-web-speech-api'
    voice = useVoiceStore()
    devices = useSettingsAudioDevice()
    return () => h('div')
  } }))
  // The Hearing store loads provider metadata, which reads translations that this test does not need.
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false }))
  const element = document.body.appendChild(document.createElement('div'))
  app.mount(element)
  const changes: boolean[] = []
  const stopChanges = getSpeechBusContext().on(speechInputUserSpeakingChangedEvent, ({ body }) => {
    if (body)
      changes.push(body.speaking)
  })
  cleanups.push(() => {
    stopChanges()
    app.unmount()
    disposePinia(pinia)
    element.remove()
  })
  return { voice, devices, changes }
}

describe('voice store user speech', () => {
  it('stays false while voice input is off', async () => {
    const { voice, changes } = mountVoice()

    expect(voice.userSpeaking).toBe(false)
    expect(changes).toEqual([])
  })

  it('reports a capturing input until it ends and sends each change on the speech bus', async () => {
    const { voice, devices, changes } = mountVoice()
    // The device list decides which microphone the system default opens. A later choice would replace the input's audio.
    expect(await devices.askPermission()).toBe(true)
    await expect.poll(() => devices.selectedAudioInput).not.toBe('')

    const attempt = voice.beginManual('alice')
    await expect.poll(() => attempt.state.phase, { timeout: 10_000 }).toBe('capturing')
    expect(voice.userSpeaking).toBe(true)

    voice.cancelInput()
    expect((await attempt.done).status).toBe('cancelled')
    expect(voice.userSpeaking).toBe(false)
    await expect.poll(() => changes).toEqual([true, false])
  })

  it('reports an unsent voice draft until it is discarded and sends each change on the speech bus', async () => {
    const { voice, changes } = mountVoice()
    const draft = { id: 'draft', sessionId: 'alice', rawText: 'hello', text: 'hello' }

    // A draft the host is already sending is no longer waiting for the user.
    voice.$patch({ drafts: [{ ...draft, sending: true }] })
    expect(voice.userSpeaking).toBe(false)

    voice.$patch({ drafts: [{ ...draft, sending: false }] })
    expect(voice.state).toBeUndefined()
    expect(voice.userSpeaking).toBe(true)
    await expect.poll(() => changes).toEqual([true])

    expect(voice.discardDraft('draft')).toBe(true)
    expect(voice.userSpeaking).toBe(false)
    await expect.poll(() => changes).toEqual([true, false])
  })
})
