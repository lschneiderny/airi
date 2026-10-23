import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { createPinia, defineStore, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, inject } from 'vue'
import { createI18n } from 'vue-i18n'

import { getSpeechBusContext, voiceSnapshotChanged } from '../services/speech/bus'
import { useHearingStore } from '../stores/modules/hearing'
import { useVoiceStore } from '../stores/voice'
import { injectKeyPiniaSynced, setupSynced } from './pinia/setup-synced'

/** setupSynced elects its leader in this namespace. */
const NAMESPACE = 'airi:stage:pinia'

/** The `pagehide` listeners of this page, in registration order, as the browser keeps them. */
const pageHideListeners: { listener: EventListenerOrEventListenerObject, capture: boolean, once: boolean }[] = []

/**
 * Dispatches `pagehide` as the browser does when the page unloads: capture listeners first, then the others, each in
 * registration order, with a microtask checkpoint after every listener. A `window.dispatchEvent` call from a test runs
 * no checkpoint between listeners, because the test's own script stays on the stack.
 */
async function hidePage() {
  const event = new PageTransitionEvent('pagehide', { persisted: false })
  for (const entry of [...pageHideListeners.filter(entry => entry.capture), ...pageHideListeners.filter(entry => !entry.capture)]) {
    // An earlier listener can remove a later one.
    if (!pageHideListeners.includes(entry))
      continue
    if (entry.once)
      pageHideListeners.splice(pageHideListeners.indexOf(entry), 1)
    if (typeof entry.listener === 'function')
      entry.listener.call(window, event)
    else
      entry.listener.handleEvent(event)
    // A task boundary runs every pending promise reaction first, as the checkpoint after a listener does.
    await new Promise(resolve => setTimeout(resolve))
  }
}

const addEventListener = window.addEventListener
const removeEventListener = window.removeEventListener

// Records every `pagehide` listener, so hidePage can call them as the browser does.
beforeAll(() => {
  window.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (type === 'pagehide' && listener)
      pageHideListeners.push({ listener, capture: typeof options === 'boolean' ? options : !!options?.capture, once: typeof options === 'object' && !!options.once })
    if (listener)
      addEventListener.call(window, type, listener, options)
  } as typeof window.addEventListener
  window.removeEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture
    const index = pageHideListeners.findIndex(entry => type === 'pagehide' && entry.listener === listener && entry.capture === capture)
    if (index >= 0)
      pageHideListeners.splice(index, 1)
    if (listener)
      removeEventListener.call(window, type, listener, options)
  } as typeof window.removeEventListener
})

afterAll(() => {
  window.addEventListener = addEventListener
  window.removeEventListener = removeEventListener
})

/** Stands in for a chat send: the leader runs the reply that the current `leaderReply` describes. */
let leaderReply: () => Promise<string> = async () => 'unset'
const useReplyStore = defineStore('page-hide-test-reply', () => {
  async function reply() {
    return leaderReply()
  }
  return { reply }
}, { synced: { actions: ['reply'] } })

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  localStorage.clear()
})

/** Mounts a Stage page: the synced runtime of setupSynced, and the voice store that hosts the voice output. */
function mountStage() {
  const synced = setupSynced({ leadership: 'leader-only' })
  const pinia = createPinia()
  pinia.use(synced.pinia)
  let voice!: ReturnType<typeof useVoiceStore>
  const app = createApp(defineComponent({ setup() {
    useHearingStore().activeTranscriptionProvider = 'browser-web-speech-api'
    voice = useVoiceStore()
    useReplyStore()
    return () => h('div')
  } }))
  app.use(pinia).use(synced.vue).use(createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false }))
  const element = document.body.appendChild(document.createElement('div'))
  app.mount(element)
  const runtime = app.runWithContext(() => inject(injectKeyPiniaSynced))
  if (!runtime)
    throw new Error('setupSynced provided no runtime')
  cleanups.push(() => {
    app.unmount()
    disposePinia(pinia)
    element.remove()
  })
  const disconnect = voice.connectOutput(() => {
    throw new Error('This test opens no response')
  })
  cleanups.push(disconnect)
  return { runtime }
}

/** Another window of the same synchronization domain, which runs the reply store. */
function mountWindow(leadership: 'leader-only' | 'follower-only', callTimeout: number) {
  const runtime = createSyncedPiniaPlugin({ namespace: NAMESPACE, leadership, callTimeout })
  const pinia = createPinia()
  pinia.use(runtime.plugin)
  createApp({ render: () => null }).use(pinia)
  const store = useReplyStore(pinia)
  cleanups.push(() => {
    runtime.dispose()
    disposePinia(pinia)
  })
  return { runtime, store }
}

function untilLeaderIs(runtime: SyncedPiniaRuntime, leaderId: string) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(reject, 5000, new Error('Leader election timed out'))
    // The runtime reports the current coordination at once, then every change.
    const stop = runtime.onCoordinationChange((coordination) => {
      if (coordination.leaderId !== leaderId)
        return
      clearTimeout(timeout)
      queueMicrotask(() => stop())
      resolve()
    })
  })
}

function untilLeading(runtime: SyncedPiniaRuntime) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(reject, 5000, new Error('Leadership timed out'))
    const stop = runtime.onLeadershipChange((isLeader) => {
      if (!isLeader)
        return
      clearTimeout(timeout)
      queueMicrotask(() => stop())
      resolve()
    })
  })
}

describe('page hide', () => {
  it('releases the voice output host and closes the synced runtime with no promise reaction in between', async () => {
    const { runtime } = mountStage()
    await untilLeading(runtime)
    const steps: string[] = []
    cleanups.push(getSpeechBusContext().on(voiceSnapshotChanged, ({ body }) => {
      if (body?.connected !== false)
        return
      steps.push('host released')
      queueMicrotask(() => steps.push('promise reaction'))
    }))
    const dispose = runtime.dispose
    vi.spyOn(runtime, 'dispose').mockImplementation(() => {
      steps.push('runtime closed')
      dispose()
    })

    await hidePage()

    // A request that the host release failed must not reach its caller as an answer before the runtime closes.
    expect(steps).toEqual(['host released', 'runtime closed', 'promise reaction'])
  })

  it('delivers a follower call that the host release failed to the next leader, instead of failing it', async () => {
    const stage = mountStage()
    await untilLeading(stage.runtime)
    const follower = mountWindow('follower-only', 20_000)
    await untilLeaderIs(follower.runtime, stage.runtime.participantId)
    // The leader's turn speaks through its voice host, so the host release cancels it, as a reload does.
    const started = Promise.withResolvers<void>()
    leaderReply = () => new Promise<string>((_resolve, reject) => {
      const stop = getSpeechBusContext().on(voiceSnapshotChanged, ({ body }) => {
        if (body?.connected !== false)
          return
        stop()
        reject(new DOMException('Chat turn cancelled', 'AbortError'))
      })
      started.resolve()
    })
    const call = follower.store.reply()
    await started.promise

    await hidePage()
    leaderReply = async () => 'answered by the next leader'
    // The reloaded page elects itself. It stops waiting for its predecessor's state after 1 s.
    const next = mountWindow('leader-only', 1000)
    await untilLeading(next.runtime)

    expect(await call).toBe('answered by the next leader')
  })
})
