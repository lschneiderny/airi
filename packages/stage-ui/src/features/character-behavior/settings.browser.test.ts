import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { useExpressionPerformanceSettings } from '../performance/settings'
import { useSituationSettings } from '../situation/settings'
import { defaultCharacterBehaviorSettings, useCharacterBehaviorSettings } from './settings'

const key = 'settings/character-behavior'
const cleanups: Array<() => void> = []

function context(runtime?: SyncedPiniaRuntime) {
  const pinia = createPinia()
  if (runtime)
    pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  cleanups.push(() => {
    runtime?.dispose()
    disposePinia(pinia)
  })
  return useCharacterBehaviorSettings(pinia)
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
      if (!ready())
        return
      clearTimeout(timeout)
      stop?.()
      resolve()
    })
  })
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  localStorage.clear()
  vi.restoreAllMocks()
})

it('saves imported fields before a narrowed document writes, surviving a reload', async () => {
  localStorage.setItem('settings/situation', JSON.stringify({ dontDisturb: true, quietApps: ['game'], shareWindowTitles: false }))
  localStorage.setItem('settings/mmd/natural', JSON.stringify({ idleActivities: false }))
  const store = context()
  expect(store.document.speaking.dontDisturb).toBe(true)
  const narrowed = useSituationSettings()
  await narrowed.update({ shareWindowTitles: true })
  expect(JSON.parse(localStorage.getItem('settings/situation')!)).toMatchObject({ shareWindowTitles: true })
  expect(JSON.parse(localStorage.getItem('settings/situation')!)).not.toHaveProperty('dontDisturb')
  const reloaded = context()
  expect(reloaded.document.idleActivities).toBe(false)
  expect(reloaded.document.speaking.dontDisturb).toBe(true)
  expect(reloaded.document.speaking.quietApps).toEqual(['game'])
})

it('preserves emotion choices before the realisation document drops its old fields', async () => {
  localStorage.setItem('settings/expression-performance', JSON.stringify({ mood: false, heldEmotions: false, slots: { holdSeconds: 3 } }))
  const behavior = context()
  const realisation = useExpressionPerformanceSettings()
  expect(realisation.document.slots.holdSeconds).toBe(3)
  expect(realisation.document).not.toHaveProperty('mood')
  await realisation.update({ autoExpressions: false })
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ emotion: { mood: false, heldEmotions: false } })
  expect(JSON.parse(localStorage.getItem('settings/expression-performance')!)).not.toHaveProperty('mood')
  expect(context().document).toEqual(behavior.document)
})

it('leaves the old document intact when the import cannot be saved', async () => {
  const old = JSON.stringify({ dontDisturb: true, shareWindowTitles: false })
  localStorage.setItem('settings/situation', old)
  context()
  const narrowed = useSituationSettings()
  const setItem = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, storageKey, value) {
    if (storageKey === key)
      throw new Error('Storage unavailable')
    setItem.call(this, storageKey, value)
  })
  await expect(narrowed.update({ shareWindowTitles: true })).rejects.toThrow('Storage unavailable')
  expect(localStorage.getItem('settings/situation')).toBe(old)
  expect(narrowed.document.shareWindowTitles).toBe(false)
})

it('does not recreate imported state after reset and the deletion sweep', async () => {
  localStorage.setItem('settings/mmd/natural', JSON.stringify({ idleActivities: false }))
  const behavior = context()
  await behavior.reset()
  localStorage.removeItem(key)
  await behavior.initialize()
  expect(localStorage.getItem(key)).toBeNull()
  expect(behavior.document.idleActivities).toBe(true)
})

it('leaves empty startup unwritten and deep merges commands', async () => {
  const store = context()
  await store.initialize()
  expect(localStorage.getItem(key)).toBeNull()
  await store.update({ emotion: { intensity: { clear: 0.7 } }, speaking: { quietApps: [] } })
  expect(store.document.emotion.intensity.clear).toBe(0.7)
  expect(store.document.emotion.intensity.slight).toBe(0.25)
  expect(store.document.speaking.quietApps).toEqual([])
  await store.reset()
  expect(store.document).toEqual(defaultCharacterBehaviorSettings())
})

it('routes import and updates through the leader without snapshot proposals or repeated saves', async () => {
  localStorage.setItem('settings/live2d/natural', JSON.stringify({ touch: false }))
  const namespace = `behavior:${crypto.randomUUID()}`
  const leaderRuntime = createSyncedPiniaPlugin({ namespace, leadership: 'leader-only' })
  const leader = context(leaderRuntime)
  await coordinated(leaderRuntime, () => leaderRuntime.isLeader())
  const followerRuntime = createSyncedPiniaPlugin({ namespace, leadership: 'follower-only' })
  const follower = context(followerRuntime)
  await coordinated(followerRuntime, () => followerRuntime.getLeaderId() === leaderRuntime.participantId)
  const persist = vi.spyOn(Storage.prototype, 'setItem')
  await follower.initialize()
  await follower.initialize()
  expect(persist.mock.calls.filter(([storageKey]) => storageKey === key)).toHaveLength(1)
  let proposals = 0
  leader.$subscribe(() => proposals++, { flush: 'sync' })
  await follower.update({ touchReactions: true })
  await follower.initialize()
  expect(follower.document).toEqual(leader.document)
  expect(proposals).toBe(1)
  expect(persist.mock.calls.filter(([storageKey]) => storageKey === key)).toHaveLength(2)
})
