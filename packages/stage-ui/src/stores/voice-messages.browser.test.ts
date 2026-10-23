import type { VoiceMessageSnapshot } from '../libs/voice/voice-message'

import { defineInvoke } from '@moeru/eventa'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { getSpeechBusContext, voiceMessageCommand, voiceMessagesChanged } from '../services/speech/bus'
import { useVoiceMessagesStore } from './voice-messages'

const cleanups: (() => void)[] = []

/**
 * The longest wait for a phase. Capture starts after the fake microphone, the
 * audio context and the capture worklet module are ready, and encoding runs
 * after that. On a loaded machine these took longer than the 1 s of
 * `expect.poll`, so the wait follows the snapshot events instead of a clock and
 * keeps this bound only to fail with a message.
 */
const PHASE_TIMEOUT_MS = 10_000

afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  localStorage.clear()
})

/** Mounts the host store with the browser microphone adapter, then connects its command handler to the speech bus. */
function connectHost() {
  const pinia = createPinia()
  let store!: ReturnType<typeof useVoiceMessagesStore>
  const app = createApp(defineComponent({ setup() {
    store = useVoiceMessagesStore()
    return () => h('div')
  } }))
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en: {} } }))
  const element = document.body.appendChild(document.createElement('div'))
  app.mount(element)
  const disconnect = store.connect()
  const snapshots: (readonly VoiceMessageSnapshot[])[] = []
  const listeners = new Set<() => void>()
  const stopSnapshots = getSpeechBusContext().on(voiceMessagesChanged, ({ body }) => {
    if (body)
      snapshots.push(body)
    listeners.forEach(listener => listener())
  })
  const latest = () => snapshots.at(-1) ?? []
  /** Resolves when the first message is in `phase`, now or at a later snapshot. */
  function reachPhase(phase: VoiceMessageSnapshot['phase']) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check)
        reject(new Error(`The voice message did not reach ${phase} within ${PHASE_TIMEOUT_MS} ms. Its phase is ${latest()[0]?.phase}.`))
      }, PHASE_TIMEOUT_MS)
      function check() {
        if (latest()[0]?.phase !== phase)
          return
        clearTimeout(timer)
        listeners.delete(check)
        resolve()
      }
      listeners.add(check)
      check()
    })
  }
  cleanups.push(() => {
    stopSnapshots()
    disconnect()
    app.unmount()
    disposePinia(pinia)
    element.remove()
  })
  return { store, latest, reachPhase }
}

describe('voice messages host', () => {
  it('encodes and sends a finished recording, then keeps it with the send error for retry', async () => {
    const { store, latest, reachPhase } = connectHost()
    const command = defineInvoke(getSpeechBusContext(), voiceMessageCommand)

    await command({ type: 'record', id: 'message', sessionId: 'alice', replyToMessageId: 'reply-target' })
    await reachPhase('capturing')
    expect(store.isRecording).toBe(true)

    // The test has no chat session or provider, so the send fails after encoding. The host must keep the recording.
    await command({ type: 'finish', id: 'message', send: true })

    const [message] = latest()
    expect(message.phase).toBe('ready')
    expect(message.error).toBeTypeOf('string')
    expect(message.audio?.type).toBe('audio/wav')
    expect(store.isRecording).toBe(false)
  })

  it('finishes without sending when the control does not ask for it', async () => {
    const { latest, reachPhase } = connectHost()
    const command = defineInvoke(getSpeechBusContext(), voiceMessageCommand)

    await command({ type: 'record', id: 'message', sessionId: 'alice' })
    await reachPhase('capturing')
    await command({ type: 'finish', id: 'message' })

    await reachPhase('ready')
    expect(latest()[0].error).toBeUndefined()
  })
})
