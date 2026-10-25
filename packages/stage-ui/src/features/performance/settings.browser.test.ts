import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { useExpressionPerformanceSettings } from './settings'

const key = 'settings/expression-performance'
const contexts: Array<{ pinia: ReturnType<typeof createPinia>, runtime?: SyncedPiniaRuntime }> = []

function createContext(namespace?: string, leadership?: LeadershipMode) {
  const pinia = createPinia()
  const runtime = namespace ? createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 2000 }) : undefined
  if (runtime)
    pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  contexts.push({ pinia, runtime })
  return { store: useExpressionPerformanceSettings(pinia), runtime }
}

function coordinated(runtime: SyncedPiniaRuntime, predicate: () => boolean) {
  if (predicate())
    return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let stop: (() => void) | undefined
    const timeout = setTimeout(() => {
      stop?.()
      reject(new Error('Coordination timed out'))
    }, 5000)
    stop = runtime.onCoordinationChange(() => {
      if (predicate()) {
        clearTimeout(timeout)
        stop?.()
        resolve()
      }
    })
  })
}

describe('expression performance settings', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    for (const { pinia, runtime } of contexts.splice(0)) {
      runtime?.dispose()
      disposePinia(pinia)
    }
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('loads defaults and resets persisted updates', async () => {
    const { store } = createContext()
    expect(store.document).toEqual(defaultExpressionPerformanceSettings)
    await store.update({ bands: false })
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(store.document)
    await store.reset()
    expect(store.document).toEqual(defaultExpressionPerformanceSettings)
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(defaultExpressionPerformanceSettings)
  })

  it.each(['{"intensity":{"clear":2}}', '{"bands":"true"}', '{"extra":true}', '{"intensity":[]}'])('rejects invalid stored input %s', (value) => {
    localStorage.setItem(key, value)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createContext().store.document).toEqual(defaultExpressionPerformanceSettings)
    expect(warning).toHaveBeenCalledOnce()
  })

  it('probes corrupt JSON storage and prints the recovered document', () => {
    localStorage.setItem(key, '{corrupt')
    const warning = vi.spyOn(console, 'warn')
    const { store } = createContext()
    expect(store.document).toEqual(defaultExpressionPerformanceSettings)
    expect(warning).toHaveBeenCalledWith('[expression-performance] Invalid stored settings:', expect.any(String))
    console.warn('PASS corrupt storage recovered:', JSON.stringify(store.document))
  })

  const removedEnergyKeys = { energyAmplitude: 0.3, energyRate: 0.5, energySeconds: 2 }
  const withBands = (extra: Record<string, unknown>, rest: Record<string, unknown> = {}) => JSON.stringify({
    ...rest,
    naturalBands: { ...defaultExpressionPerformanceSettings.naturalBands, ...extra },
  })

  it('drops the removed energy keys from a stored document and keeps every other field', () => {
    const { energyAmplitude: _a, energyRate: _r, energySeconds: _s, ...kept } = { ...defaultExpressionPerformanceSettings.naturalBands, ...removedEnergyKeys }
    localStorage.setItem(key, withBands({ ...removedEnergyKeys, headGain: 0.2 }, { bands: false, intensity: { ...defaultExpressionPerformanceSettings.intensity, clear: 0.7 }, mood: false }))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { store } = createContext()
    expect(warning).not.toHaveBeenCalled()
    expect(store.document).toEqual({
      ...defaultExpressionPerformanceSettings,
      bands: false,
      mood: false,
      intensity: { ...defaultExpressionPerformanceSettings.intensity, clear: 0.7 },
      naturalBands: { ...kept, headGain: 0.2 },
    })
    expect(store.document.naturalBands).not.toHaveProperty('energySeconds')
  })

  it.each([
    ['the three keys with wrong types are still dropped', withBands({ energyAmplitude: 'x', energyRate: null, energySeconds: [] }), false],
    ['another unknown naturalBands key', withBands({ energyBogus: 1 }), true],
    ['another unknown key beside the removed keys', withBands({ ...removedEnergyKeys, energyBogus: 1 }), true],
    ['an unknown top-level key beside the removed keys', withBands(removedEnergyKeys, { extra: true }), true],
    ['an invalid field beside the removed keys', withBands(removedEnergyKeys, { intensity: { clear: 2 } }), true],
    ['a non-object naturalBands', '{"naturalBands":5}', true],
    ['a null naturalBands', '{"naturalBands":null}', true],
    ['an array naturalBands', '{"naturalBands":[]}', true],
    ['a non-object document', '[]', true],
    ['a null document', 'null', true],
    ['invalid JSON', '{"naturalBands":', true],
  ])('handles %s', (_name, stored, fallsBack) => {
    localStorage.setItem(key, stored)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { store } = createContext()
    expect(store.document).toEqual(defaultExpressionPerformanceSettings)
    expect(warning).toHaveBeenCalledTimes(fallsBack ? 1 : 0)
  })

  it('fills missing persisted fields from defaults', () => {
    localStorage.setItem(key, '{"bands":false,"intensity":{"clear":0.7}}')
    const { store } = createContext()
    expect(store.document).toEqual({
      ...defaultExpressionPerformanceSettings,
      bands: false,
      intensity: { ...defaultExpressionPerformanceSettings.intensity, clear: 0.7 },
    })
  })

  it('deep-merges valid partial patches without losing siblings', async () => {
    const { store } = createContext()
    expect(await store.update({ intensity: { clear: 0.7 }, naturalBands: { slight: { faceHold: 0.2 } } })).toEqual({ success: true })
    expect(store.document.intensity).toEqual({ ...defaultExpressionPerformanceSettings.intensity, clear: 0.7 })
    expect(store.document.naturalBands.slight).toEqual({ ...defaultExpressionPerformanceSettings.naturalBands.slight, faceHold: 0.2 })
  })

  it.each([{ intensity: { clear: 2 } }, { bands: 'true' }, { extra: true }, { intensity: null }, { intensity: [] }])('rejects invalid patches without changing state or storage: %j', async (patch) => {
    const { store } = createContext()
    await store.update({ bands: false })
    const before = structuredClone(store.document)
    const stored = localStorage.getItem(key)
    // @ts-expect-error Deliberately exercise malformed runtime input.
    const result = await store.update(patch)
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.issues.length).toBeGreaterThan(0)
    expect(store.document).toEqual(before)
    expect(localStorage.getItem(key)).toBe(stored)
  })

  it('replicates leader-owned updates without follower proposals or persistence', async () => {
    const namespace = `performance:${crypto.randomUUID()}`
    const leader = createContext(namespace, 'leader-only')
    await coordinated(leader.runtime!, () => leader.runtime!.isLeader())
    const follower = createContext(namespace, 'follower-only')
    await coordinated(follower.runtime!, () => follower.runtime!.getLeaderId() === leader.runtime!.participantId)
    const persist = vi.spyOn(Storage.prototype, 'setItem')
    const leaderAction = vi.fn()
    leader.store.$onAction(leaderAction)
    let mutations = 0
    leader.store.$subscribe(() => mutations++, { flush: 'sync' })
    const snapshot = new Promise<void>((resolve) => {
      const stop = follower.store.$subscribe(() => {
        if (!follower.store.document.mood) {
          stop()
          resolve()
        }
      }, { flush: 'sync' })
    })
    await follower.store.update({ mood: false })
    await snapshot
    // A second leader-routed command is a transport barrier, not a timing wait.
    const rejected = await follower.store.update({ intensity: { clear: 2 } })
    expect(rejected.success).toBe(false)
    expect(leader.store.document).toEqual(follower.store.document)
    expect(mutations).toBe(1)
    expect(leaderAction).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls.filter(([storageKey]) => storageKey === key)).toHaveLength(1)
    await follower.store.reset()
    expect(leader.store.document).toEqual(defaultExpressionPerformanceSettings)
  })
})
