import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { PerformanceRuntimeSnapshot } from './runtime-state'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'

import { usePerformanceRuntimeState } from './runtime-state'

const contexts: Array<{ pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime }> = []

function createContext(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 2000 })
  pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  contexts.push({ pinia, runtime })
  return { store: usePerformanceRuntimeState(pinia), runtime }
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

const snapshot: PerformanceRuntimeSnapshot = {
  exposed: [{ label: 'anger', kind: 'face' }, { label: 'game', kind: 'prop' }],
  active: [{ slot: 'prop', label: 'game' }],
  mood: { valence: 0.3, arousal: 0.2, tension: 0 },
}

describe('performance runtime state', () => {
  afterEach(() => {
    for (const { pinia, runtime } of contexts.splice(0)) {
      runtime.dispose()
      disposePinia(pinia)
    }
  })

  it('replicates the stage snapshot to a reader window without proposals from the reader', async () => {
    const namespace = `performance-runtime:${crypto.randomUUID()}`
    const stage = createContext(namespace, 'leader-only')
    await coordinated(stage.runtime, () => stage.runtime.isLeader())
    const reader = createContext(namespace, 'follower-only')
    await coordinated(reader.runtime, () => reader.runtime.getLeaderId() === stage.runtime.participantId)
    let stageMutations = 0
    stage.store.$subscribe(() => stageMutations++, { flush: 'sync' })
    const received = new Promise<void>((resolve) => {
      const stop = reader.store.$subscribe(() => {
        if (reader.store.mood !== null) {
          stop()
          resolve()
        }
      }, { flush: 'sync' })
    })

    stage.store.publish(snapshot)
    await received
    const afterFirst = stageMutations
    // An identical publication changes nothing, so it sends nothing.
    stage.store.publish(structuredClone(snapshot))

    expect({ exposed: reader.store.exposed, active: reader.store.active, mood: reader.store.mood }).toEqual(snapshot)
    expect(afterFirst).toBeGreaterThan(0)
    expect(stageMutations).toBe(afterFirst)

    // A second publication is the transport barrier: had the reader proposed the snapshot back,
    // the stage would have observed an extra mutation before this one arrives.
    const cleared = new Promise<void>((resolve) => {
      const stop = reader.store.$subscribe(() => {
        if (reader.store.active.length === 0) {
          stop()
          resolve()
        }
      }, { flush: 'sync' })
    })
    stage.store.publish({ ...snapshot, active: [] })
    await cleared
    expect(stageMutations).toBe(afterFirst + 1)
    expect(reader.store.exposed).toEqual(snapshot.exposed)
  })
})
