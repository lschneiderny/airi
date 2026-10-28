import type { SpeechOutput } from '@proj-airi/core-agent'

import type { VoiceHostSnapshot } from '../services/speech/bus'

import { Playback } from '@proj-airi/pipelines-audio'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { getSpeechBusContext, speechInputUserSpeakingChangedEvent, voiceInputLevel, voiceLevelMonitor, voiceSnapshotChanged } from '../services/speech/bus'
import { useHearingStore } from './modules/hearing'
import { useSpeechStore } from './modules/speech'
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
    if (!attempt)
      throw new Error('The voice store refused a manual input while the microphone is on')
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

describe('voice store microphone switch', () => {
  // The microphone switch ends every input, also dictation in a composer, and the input is cancelled, not submitted.
  it('cancels a capturing input and refuses a new one while the microphone is off', async () => {
    const { voice, devices } = mountVoice()
    // The output host owns the watchers that end inputs and publish levels, as the Stage connects it in the app.
    cleanups.push(voice.connectOutput(() => {
      throw new Error('This test opens no response')
    }))
    expect(await devices.askPermission()).toBe(true)
    await expect.poll(() => devices.selectedAudioInput).not.toBe('')
    const attempt = voice.beginManual('alice')
    if (!attempt)
      throw new Error('The voice store refused a manual input while the microphone is on')
    await expect.poll(() => attempt.state.phase, { timeout: 10_000 }).toBe('capturing')

    devices.off = true

    expect((await attempt.done).status).toBe('cancelled')
    expect(voice.beginManual('alice')).toBeUndefined()
    // Browser test files run in parallel and share storage. Turn the persisted switch back at once.
    devices.off = false
  })

  // A level meter in a menu asks for the level when a hover opens the menu. The host must read it only from the input
  // that the listening preference already holds open, and turning listening off closes the microphone.
  it('publishes a requested level while listening holds the microphone open, and closes it when listening turns off', async () => {
    const { voice, devices } = mountVoice()
    // The output host owns the watchers that end inputs and publish levels, as the Stage connects it in the app.
    cleanups.push(voice.connectOutput(() => {
      throw new Error('This test opens no response')
    }))
    devices.initialize()
    expect(await devices.askPermission()).toBe(true)
    await expect.poll(() => devices.selectedAudioInput).not.toBe('')
    const context = getSpeechBusContext()
    const levels: number[] = []
    cleanups.push(context.on(voiceInputLevel, ({ body }) => body && levels.push(body.level)))

    devices.enabled = true
    expect(devices.heldOpen).toBe(true)
    context.emit(voiceLevelMonitor, { until: Date.now() + 10_000 })

    // The first level waits for the device and the capture worklet, which is slow while other test files run.
    await expect.poll(() => levels.length, { timeout: 10_000 }).toBeGreaterThan(0)
    const track = devices.stream!.getAudioTracks()[0]

    devices.enabled = false
    expect(devices.heldOpen).toBe(false)

    await expect.poll(() => track.readyState).toBe('ended')
  })
})

describe('voice store optional modules', () => {
  it('refuses a manual input while Hearing is off', () => {
    const { voice } = mountVoice()
    useHearingStore().enabled = false

    expect(voice.beginManual('alice')).toBeUndefined()
  })

  // https://github.com/moeru-ai/airi/issues/3153
  // Disabling Speech stops its synthesis and playback. The response stays open, so the chat turn can finish.
  it('stops speech playback and keeps the turn open when Speech is disabled', async () => {
    const { voice } = mountVoice()
    const settings = useSpeechStore()
    settings.enabled = true
    const turn = { sessionId: 'alice', turnId: 'speech-disabled' }
    const stopped = vi.fn(async () => ({ throughMs: 10 }))
    const played = vi.fn(() => ({ done: new Promise<{ throughMs: number }>(() => {}), stop: stopped }))
    let synthesisSignal: AbortSignal | undefined
    const output: SpeechOutput = {
      playback: new Playback({ nowMs: () => 0, play: played }),
      stream: async (_text, signal) => {
        synthesisSignal = signal
        return new ReadableStream({ start(controller) {
          controller.enqueue({ audio: new Blob(['speech']), text: 'Hello.' })
        } })
      },
    }
    cleanups.push(voice.connectOutput(() => output))
    voice.startResponse(turn)
    await voice.getSpeech(turn)!.write('Hello.')
    await expect.poll(() => played.mock.calls.length).toBe(1)

    settings.enabled = false

    expect(voice.activeTurns).toEqual([turn])
    await expect.poll(() => synthesisSignal?.aborted).toBe(true)
    await expect.poll(() => stopped.mock.calls.length).toBe(1)
    expect(await voice.getSpeech(turn)!.write('Later text.')).toEqual({ status: 'closed' })
    expect(await voice.finishResponse(turn)).toBe('finished')
    expect(voice.activeTurns).toEqual([])
  })
})
