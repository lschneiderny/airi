import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { useSettingsDocument } from '@proj-airi/stage-shared/composables'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { boolean, optional } from 'valibot'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, effectScope } from 'vue'

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
  await store.initialize()
  const scope = effectScope()
  cleanups.push(() => scope.stop())
  const narrowed = scope.run(() => useSettingsDocument('settings/situation', {
    shareWindowTitles: optional(boolean(), true),
  }, { label: 'narrowed-situation' }))!
  await narrowed.update({ shareWindowTitles: true })
  expect(JSON.parse(localStorage.getItem('settings/situation')!)).toEqual({ shareWindowTitles: true })
  const reloaded = context()
  expect(reloaded.document.idleActivities).toBe(false)
  expect(reloaded.document.speaking.dontDisturb).toBe(true)
  expect(reloaded.document.speaking.quietApps).toEqual(['game'])
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
