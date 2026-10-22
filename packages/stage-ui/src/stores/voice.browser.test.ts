import type { VoiceHostSnapshot } from '../services/speech/bus'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { getSpeechBusContext, speechInputUserSpeakingChangedEvent, voiceSnapshotChanged } from '../services/speech/bus'
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

  it('does not count an unsent voice draft as user speech while nothing is capturing', async () => {
    const { voice, changes } = mountVoice()

    voice.$patch({ drafts: [{ id: 'draft', sessionId: 'alice', rawText: 'hello', text: 'hello', sending: false }] })
    expect(voice.state).toBeUndefined()
    expect(voice.userSpeaking).toBe(false)

    // The speech bus delivers events in order, so a marker sent after the patch arrives after any change the patch caused.
    await nextTick()
    getSpeechBusContext().emit(speechInputUserSpeakingChangedEvent, { speaking: false })
    await expect.poll(() => changes).toEqual([false])
  })
})

describe('voice store output host', () => {
  it('names each output connection, and detaches when its page hides', () => {
    const { voice } = mountVoice()
    const snapshots: VoiceHostSnapshot[] = []
    const stop = getSpeechBusContext().on(voiceSnapshotChanged, ({ body }) => {
      if (body)
        snapshots.push(body)
    })
    cleanups.push(stop)
    const failOutput = () => {
      throw new Error('This test opens no response')
    }

    const disconnect = voice.connectOutput(failOutput)
    const first = snapshots.at(-1)
    expect(first).toMatchObject({ connected: true, hostId: expect.any(String) })

    // A reload hides the page first. The host leaves the bus then, so no window waits for its answers.
    window.dispatchEvent(new Event('pagehide'))
    expect(snapshots.at(-1)).toEqual({ connected: false, drafts: [] })
    disconnect()
    expect(snapshots.filter(snapshot => !snapshot.connected)).toHaveLength(1)

    cleanups.push(voice.connectOutput(failOutput))
    expect(snapshots.at(-1)).toMatchObject({ connected: true, hostId: expect.any(String) })
    expect(snapshots.at(-1)?.hostId).not.toBe(first?.hostId)
  })
})
