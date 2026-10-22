import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { createPinia, defineStore, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, inject, ref } from 'vue'

import { injectKeyPiniaSynced, setupSynced } from './setup-synced'

/** tab-election publishes each committed domain state of the `airi:stage:pinia` namespace on this channel. */
const DOMAIN_CHANNEL = 'tab-airi:stage:pinia'
const CALL_TIMEOUT_MS = 5 * 60 * 1000

interface CommittedDomainState {
  operations: Array<{ id: string, result?: unknown }>
}

const useCounterStore = defineStore('setup-synced-test-counter', () => {
  const count = ref(0)
  async function increment() {
    count.value += 1
    return count.value
  }
  return { count, increment }
}, { synced: { actions: ['increment'], state: true } })

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  vi.useRealTimers()
})

function mountLeader() {
  return mount('leader-only')
}

function mount(leadership: 'leader-only' | 'follower-only') {
  const { pinia: plugin, vue } = setupSynced({ leadership })
  const pinia = createPinia()
  pinia.use(plugin)
  const app = createApp({ render: () => null })
  app.use(pinia).use(vue)
  const element = document.createElement('div')
  app.mount(element)
  cleanups.push(() => {
    app.unmount()
    disposePinia(pinia)
  })
  const runtime = app.runWithContext(() => inject(injectKeyPiniaSynced))
  if (!runtime)
    throw new Error('setupSynced provided no runtime')
  return { runtime, store: useCounterStore(pinia) }
}

function untilLeader(runtime: SyncedPiniaRuntime) {
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

/** Resolves with the next committed domain state that records the operation that returned `result`. */
function untilCommitted(channel: BroadcastChannel, result: number) {
  return new Promise<CommittedDomainState>((resolve, reject) => {
    const timeout = setTimeout(reject, 5000, new Error('Commit timed out'))
    const listener = ({ data }: MessageEvent<{ name?: string, rest?: [CommittedDomainState] }>) => {
      const state = data?.name === 'onState' ? data.rest?.[0] : undefined
      if (!state?.operations.some(operation => operation.result === result))
        return
      clearTimeout(timeout)
      channel.removeEventListener('message', listener)
      resolve(state)
    }
    channel.addEventListener('message', listener)
  })
}

describe('setupSynced', () => {
  it('keeps completed operation records only while a caller can still retry them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const channel = new BroadcastChannel(DOMAIN_CHANNEL)
    cleanups.push(() => channel.close())
    const { runtime, store } = mountLeader()
    await untilLeader(runtime)

    for (let index = 1; index <= 3; index++) {
      const committed = untilCommitted(channel, index)
      expect(await store.increment()).toBe(index)
      expect((await committed).operations).toHaveLength(index)
    }

    // Every earlier call has timed out by now, so no caller can retry it and read its record.
    vi.setSystemTime(Date.now() + CALL_TIMEOUT_MS + 1000)
    const committed = untilCommitted(channel, 4)
    expect(await store.increment()).toBe(4)
    expect((await committed).operations.map(operation => operation.result)).toEqual([4])
  })

  it('answers a call that a follower delivers again within the window with its recorded result', async () => {
    const channel = new BroadcastChannel(DOMAIN_CHANNEL)
    cleanups.push(() => channel.close())
    const calls: Array<{ rest: [string, number, string, { actionName?: string }] }> = []
    const returns: Array<{ callNumber: unknown, result: unknown }> = []
    channel.addEventListener('message', ({ data }: MessageEvent<{ name?: string, rest?: unknown[] }>) => {
      if (data?.name === 'onCall')
        calls.push(data as typeof calls[number])
      if (data?.name === 'onReturn')
        returns.push({ callNumber: data.rest?.[0], result: data.rest?.[2] })
    })
    const leader = mountLeader()
    await untilLeader(leader.runtime)
    const follower = mount('follower-only')
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))

    expect(await follower.store.increment()).toBe(1)
    expect(await follower.store.increment()).toBe(2)
    const firstCall = calls.find(call => call.rest[2] === 'invokeAction' && call.rest[3].actionName === 'increment')!

    // tab-election delivers calls at least once, for example again to a new leader. The leader finds the record of the
    // first call and answers with its result instead of running the action a second time.
    const answered = returns.filter(entry => entry.callNumber === firstCall.rest[1]).length
    channel.postMessage(firstCall)
    await vi.waitFor(() => expect(returns.filter(entry => entry.callNumber === firstCall.rest[1]).length).toBeGreaterThan(answered))
    expect(returns.filter(entry => entry.callNumber === firstCall.rest[1]).map(entry => entry.result)).toEqual(Array.from({ length: answered + 1 }).fill(1))
    expect(leader.store.count).toBe(2)
  })
})
