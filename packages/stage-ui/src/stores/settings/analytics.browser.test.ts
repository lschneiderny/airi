import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { analyticsConsentMirrorKey, useSettingsAnalytics } from './analytics'

const cleanups: Array<() => void> = []

function context(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership })
  const mirror = vi.fn(async (_optedIn: boolean) => {})
  pinia.use(runtime.plugin)
  createApp({}).use(pinia).provide(analyticsConsentMirrorKey, mirror)
  cleanups.push(() => {
    runtime.dispose()
    disposePinia(pinia)
  })
  return { runtime, mirror, store: useSettingsAnalytics(pinia) }
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

it('routes consent and reset to one persistence and main-mirror owner without snapshot proposals', async () => {
  localStorage.setItem('settings/analytics/opted-in', 'true')
  const namespace = `consent:${crypto.randomUUID()}`
  const leader = context(namespace, 'leader-only')
  await coordinated(leader.runtime, () => leader.runtime.isLeader())
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  const follower = context(namespace, 'follower-only')
  await coordinated(follower.runtime, () => follower.runtime.getLeaderId() === leader.runtime.participantId)
  expect(writes).not.toHaveBeenCalled()
  expect(follower.mirror).not.toHaveBeenCalled()
  await leader.store.initialize()
  const traffic = vi.spyOn(BroadcastChannel.prototype, 'postMessage')
  const observed = Promise.withResolvers<void>()
  const timeout = setTimeout(() => observed.reject(new Error('Snapshot timed out')), 5000)
  const stop = follower.store.$subscribe(() => {
    if (!follower.store.analyticsEnabled)
      observed.resolve()
  }, { flush: 'sync' })
  await follower.store.update({ optedIn: false })
  await observed.promise
  clearTimeout(timeout)
  stop()
  // A rejected routed action is a transport barrier and changes no state.
  // @ts-expect-error Invalid runtime patch.
  expect((await follower.store.update({ optedIn: 'invalid' })).success).toBe(false)
  expect(leader.store.document).toEqual(follower.store.document)
  expect(writes.mock.calls.filter(([key]) => key === 'settings/analytics')).toHaveLength(2)
  expect(traffic.mock.calls.filter(([message]) => JSON.stringify(message).includes('"replaceState"'))).toEqual([])
  expect(leader.mirror.mock.calls).toEqual([[true], [false]])
  expect(follower.mirror).not.toHaveBeenCalled()
  await follower.store.reset()
  expect(leader.mirror).toHaveBeenLastCalledWith(false)
  expect(follower.mirror).not.toHaveBeenCalled()
})
