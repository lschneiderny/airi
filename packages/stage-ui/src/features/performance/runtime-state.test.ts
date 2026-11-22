import type { PerformerCapabilities } from '@proj-airi/character-mind'
import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'
import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { PerformanceRuntimeSnapshot } from './runtime-state'

import { NO_CAPABILITIES } from '@proj-airi/character-mind'
import { LIVE2D_NATURAL_CAPABILITIES } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion-adapter'
import { MMD_NATURAL_CAPABILITIES } from '@proj-airi/stage-ui-mmd/composables/mmd/natural/adapter'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, effectScope, nextTick, ref } from 'vue'

import { useStagePerformanceConductor } from '../../composables/performance/use-stage-performance-conductor'
import { useStageExpressionCatalogStore } from '../../stores/stage-expression-catalog'
import { naturalMind } from '../../test/natural-mind'
import { usePerformanceRuntimeState } from './runtime-state'

const contexts: Array<{ pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime }> = []

function createContext(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 2000 })
  pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  contexts.push({ pinia, runtime })
  return { store: usePerformanceRuntimeState(pinia), runtime, pinia }
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
  exposedActions: [{ label: 'wave', kind: 'gesture' }, { label: 'moonwalk', kind: 'dance' }],
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

  it('publishes only declared exposure while preserving the c6 mapping catalog', async () => {
    const { pinia, runtime, store } = createContext(`performance-declarations:${crypto.randomUUID()}`, 'leader-only')
    await coordinated(runtime, () => runtime.isLeader())
    setActivePinia(pinia)
    const capabilities = ref<PerformerCapabilities>(MMD_NATURAL_CAPABILITIES)
    const entry: CatalogEntry = { id: 'smile', label: 'Smile', kind: 'face', group: null, confirmed: true, exposedToLlm: true, mappings: [{ emotion: 'happy', weight: 1, minBand: 'clear' }], fileName: 'smile.exp3.json', parameterIds: ['Smile'] }
    const scope = effectScope()
    try {
      scope.run(() => useStagePerformanceConductor({
        renderer: () => 'mmd',
        scene: () => undefined,
        capabilities: () => capabilities.value,
        expressionBackend: () => ({ modelId: 'rig', catalog: [entry], llmEligibleEntries: [entry], leases: { face: null, effect: null, prop: null } }),
        listActions: () => [{ label: 'wave', kind: 'gesture', exposed: true }],
        mind: naturalMind({ seed: 1 }),
        mood: () => null,
      }))
      expect(store.exposed).toEqual([{ label: 'Smile', kind: 'face' }])
      expect(store.exposedActions).toEqual([{ label: 'wave', kind: 'gesture' }])
      capabilities.value = NO_CAPABILITIES
      await nextTick()
      expect(store.exposed).toEqual([])
      expect(store.exposedActions).toEqual([])
      expect(useStageExpressionCatalogStore().snapshot?.entries.map(entry => entry.id)).toEqual(['smile'])
      capabilities.value = LIVE2D_NATURAL_CAPABILITIES
      await nextTick()
      expect(store.exposed).toEqual([{ label: 'Smile', kind: 'face' }])
      expect(store.exposedActions).toEqual([])
    }
    finally {
      scope.stop()
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

    expect({ exposed: reader.store.exposed, exposedActions: reader.store.exposedActions, active: reader.store.active, mood: reader.store.mood }).toEqual(snapshot)
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
