import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, watch } from 'vue'

import { useMMD } from './mmd'
import { useMMDPerformanceSettings } from './performance-settings'

const cleanups: Array<() => void> = []
function context(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership })
  pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  cleanups.push(() => {
    runtime.dispose()
    disposePinia(pinia)
  })
  return { pinia, runtime, store: useMMDPerformanceSettings(pinia) }
}
function coordinated(runtime: SyncedPiniaRuntime, ready: () => boolean) {
  if (ready())
    return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let stop: (() => void) | undefined
    const timeout = setTimeout(() => {
      stop?.()
      reject(new Error('Coordination timed out'))
    }, 5000)
    stop = runtime.onCoordinationChange(() => {
      if (ready()) {
        clearTimeout(timeout)
        stop?.()
        resolve()
      }
    })
  })
}
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  localStorage.clear()
  vi.restoreAllMocks()
})

it('converges concurrent field and model edits without follower storage writes or snapshot proposals', async () => {
  localStorage.setItem('settings/models/model-a/mmd/motion-driver', 'natural')
  const namespace = `mmd-performance:${crypto.randomUUID()}`
  const leader = context(namespace, 'leader-only')
  await coordinated(leader.runtime, () => leader.runtime.isLeader())
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  const follower = context(namespace, 'follower-only')
  await coordinated(follower.runtime, () => follower.runtime.getLeaderId() === leader.runtime.participantId)
  expect(writes).not.toHaveBeenCalled()
  await leader.store.initialize()
  writes.mockClear()
  const traffic = vi.spyOn(BroadcastChannel.prototype, 'postMessage')
  const observed = Promise.withResolvers<void>()
  const timeout = setTimeout(() => observed.reject(new Error('Snapshot timed out')), 5000)
  const stop = follower.store.$subscribe(() => {
    const value = follower.store.document
    if (value.motionDrivers['model-a'] === 'classic' && value.stageCharacterHeight === 720 && value.stanceSlots['model-b']?.sleep === 'sleep')
      observed.resolve()
  }, { flush: 'sync' })
  await Promise.all([
    leader.store.setMotionDriver('model-a', 'classic'),
    follower.store.update({ stageCharacterHeight: 720 }),
    follower.store.setStanceSlot('model-b', 'sleep', 'sleep'),
  ])
  await observed.promise
  clearTimeout(timeout)
  stop()
  // The rejected action is a transport barrier and cannot change state.
  // @ts-expect-error Invalid runtime patch.
  expect((await follower.store.update({ roamMode: 'invalid' })).success).toBe(false)
  expect(leader.store.document).toEqual(follower.store.document)
  expect(writes.mock.calls.filter(([key]) => key === 'settings/mmd/performance')).toHaveLength(3)
  expect(traffic.mock.calls.filter(([message]) => JSON.stringify(message).includes('"replaceState"'))).toEqual([])
  await follower.store.setCuration('model-b', 'bow', { label: 'bow', aiMayUse: true })
  const count = writes.mock.calls.length
  await follower.store.setCuration('model-b', 'bow', { label: 'bow', aiMayUse: true })
  expect(writes.mock.calls).toHaveLength(count)
  await follower.store.reset()
  expect(leader.store.document.motionDrivers).toEqual({})
  expect(leader.store.stageCharacterHeight).toBe(560)
})

it('still delivers the upstream transient perform request to another window', async () => {
  const senderPinia = createPinia()
  const receiverPinia = createPinia()
  createApp({}).use(senderPinia)
  createApp({}).use(receiverPinia)
  cleanups.push(() => disposePinia(senderPinia), () => disposePinia(receiverPinia))
  const sender = useMMD(senderPinia)
  const receiver = useMMD(receiverPinia)
  const observed = Promise.withResolvers<unknown>()
  const timeout = setTimeout(() => observed.reject(new Error('Perform request timed out')), 2000)
  const stop = watch(() => receiver.performRequest, request => request && observed.resolve(request), { flush: 'sync' })
  sender.requestPerform('wave', { loop: true, source: 'lab' })
  expect(await observed.promise).toEqual({ name: 'wave', loop: true, source: 'lab', nonce: 1 })
  clearTimeout(timeout)
  stop()
  expect(sender.performRequest?.nonce).toBe(1)
  sender.requestPerform(null, { source: 'lab' })
  expect(sender.performRequest).toEqual({ name: null, loop: false, source: 'lab', nonce: 2 })
})
