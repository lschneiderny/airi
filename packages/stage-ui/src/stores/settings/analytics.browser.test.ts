import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { useMMDPerformanceSettings } from '@proj-airi/stage-ui-mmd/stores'
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
  return { pinia, runtime, mirror, store: useSettingsAnalytics(pinia) }
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

it.each(['legacy', 'document', 'failed-save'] as const)('imports authoritative %s values after a follower seeds the leader domain with defaults', async (source) => {
  const namespace = `consent-startup:${crypto.randomUUID()}`
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership: 'leader-only' })
  const mirror = vi.fn(async (_optedIn: boolean) => {})
  pinia.use(runtime.plugin)
  createApp({}).use(pinia).provide(analyticsConsentMirrorKey, mirror)
  cleanups.push(() => {
    runtime.dispose()
    disposePinia(pinia)
  })
  await coordinated(runtime, () => runtime.isLeader())
  const channel = new BroadcastChannel(`tab-${namespace}`)
  cleanups.push(() => channel.close())
  const seeded = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Initial snapshot timed out')), 5000)
    channel.addEventListener('message', ({ data }) => {
      if (data.name === 'onState' && data.rest?.[0]?.stores?.['settings-analytics'] && data.rest?.[0]?.stores?.['mmd-performance-settings']) {
        clearTimeout(timeout)
        resolve()
      }
    })
  })
  const follower = context(namespace, 'follower-only')
  useMMDPerformanceSettings(follower.pinia)
  await seeded
  expect(localStorage.getItem('settings/analytics')).toBeNull()
  expect(localStorage.getItem('settings/mmd/performance')).toBeNull()

  localStorage.setItem('settings/analytics/opted-in', 'true')
  localStorage.setItem('settings/mmd/stage-character-height', '840')
  localStorage.setItem('settings/mmd/roam-mode', 'roam')
  localStorage.setItem('settings/models/model-a/mmd/motion-driver', 'natural')
  localStorage.setItem('settings/models/model-b/mmd/motion-driver', 'classic')
  if (source === 'document') {
    localStorage.setItem('settings/analytics', JSON.stringify({ optedIn: true }))
    localStorage.setItem('settings/mmd/performance', JSON.stringify({ stageCharacterHeight: 960, roamMode: 'roam', motionDrivers: { 'model-b': 'classic' } }))
  }
  const analytics = useSettingsAnalytics(pinia)
  const performance = useMMDPerformanceSettings(pinia)
  // Registration applies the already-committed follower snapshot over construction's correct storage projection.
  expect(analytics.analyticsEnabled).toBe(false)
  expect(performance.stageCharacterHeight).toBe(560)
  expect(performance.document.motionDrivers).toEqual({})
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  if (source === 'failed-save') {
    writes.mockImplementation(() => {
      throw new Error('Save refused')
    })
    await expect(analytics.initialize()).rejects.toThrow('Save refused')
    await expect(performance.initialize()).rejects.toThrow('Save refused')
    expect(localStorage.getItem('settings/analytics/opted-in')).toBe('true')
    expect(localStorage.getItem('settings/mmd/stage-character-height')).toBe('840')
    expect(localStorage.getItem('settings/models/model-b/mmd/motion-driver')).toBe('classic')
    expect(mirror).not.toHaveBeenCalled()
    writes.mockRestore()
  }
  await analytics.initialize()
  // A model-map edit may reach the leader before its startup initialization action.
  await performance.setStanceSlot('model-b', 'sleep', 'rest')
  await performance.initialize()
  expect(JSON.parse(localStorage.getItem('settings/analytics')!)).toEqual({ optedIn: true })
  const saved = JSON.parse(localStorage.getItem('settings/mmd/performance')!)
  expect(saved.stageCharacterHeight).toBe(source === 'document' ? 960 : 840)
  expect(saved.roamMode).toBe('roam')
  expect(saved.stanceSlots['model-b']).toEqual({ sleep: 'rest' })
  expect(saved.motionDrivers['model-b']).toBe('classic')
  expect(saved.motionDrivers['model-a']).toBe(source === 'document' ? undefined : 'natural')
  expect(localStorage.getItem('settings/analytics/opted-in')).toBeNull()
  expect(localStorage.getItem('settings/mmd/stage-character-height')).toBeNull()
  expect(localStorage.getItem('settings/models/model-b/mmd/motion-driver')).toBeNull()
  expect(mirror).toHaveBeenCalledExactlyOnceWith(true)
  expect(follower.mirror).not.toHaveBeenCalled()
})
