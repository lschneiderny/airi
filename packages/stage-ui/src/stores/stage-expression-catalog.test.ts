import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'
import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createApp } from 'vue'

import { getAiriCardMappingEditor } from '../services/airi-card-editor'
import { useStageExpressionCatalogStore } from './stage-expression-catalog'

const contexts: Array<{ pinia: ReturnType<typeof createPinia>, runtime?: SyncedPiniaRuntime }> = []

function createContext(namespace?: string, leadership?: LeadershipMode) {
  const pinia = createPinia()
  const runtime = namespace ? createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 2000 }) : undefined
  if (runtime)
    pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  contexts.push({ pinia, runtime })
  return { store: useStageExpressionCatalogStore(pinia), runtime }
}

function entry(): CatalogEntry {
  return {
    id: 'smile',
    label: 'Smile',
    kind: 'face',
    group: null,
    confirmed: true,
    exposedToLlm: false,
    fileName: 'smile.exp3.json',
    parameterIds: ['mouth'],
    mappings: [{ emotion: 'happy', weight: 2, minBand: 'clear' }],
  }
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
    onTestFinished(() => {
      clearTimeout(timeout)
      stop?.()
    })
  })
}

function received(store: ReturnType<typeof useStageExpressionCatalogStore>, predicate: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    let stop: (() => void) | undefined
    const timeout = setTimeout(() => {
      stop?.()
      reject(new Error('Catalog snapshot timed out'))
    }, 5000)
    stop = store.$subscribe(() => {
      if (predicate()) {
        clearTimeout(timeout)
        stop?.()
        resolve()
      }
    }, { flush: 'sync' })
    onTestFinished(() => {
      clearTimeout(timeout)
      stop?.()
    })
  })
}

describe('stage expression catalog mirror', () => {
  afterEach(() => {
    for (const { pinia, runtime } of contexts.splice(0)) {
      runtime?.dispose()
      disposePinia(pinia)
    }
  })

  it('copies only mapped editor fields and leaves an identical publication unchanged', () => {
    const { store } = createContext()
    const source = entry()
    store.publish('rig', [source, { ...source, id: 'prop', mappings: [] }])
    expect(store.snapshot).toEqual({
      modelId: 'rig',
      entries: [{ id: 'smile', label: 'Smile', mappings: source.mappings }],
    })
    const published = store.snapshot
    store.publish('rig', [source])
    expect(store.snapshot).toBe(published)
    source.mappings[0].weight = 4
    expect(store.snapshot?.entries[0].mappings[0].weight).toBe(2)
  })

  it('clears an unloaded model without letting a retiring model clear its replacement', () => {
    const { store } = createContext()
    store.publish('rig', [entry()])
    store.publish('other', [entry()])
    store.clear('rig')
    expect(store.snapshot?.modelId).toBe('other')
    store.clear('other')
    expect(store.snapshot).toBeNull()
    store.publish('rig', [entry()])
    store.publish('', [])
    expect(store.snapshot).toBeNull()
  })

  it('gives a late settings window the stage catalog and clear without reader proposals', async () => {
    const namespace = `stage-expression-catalog:${crypto.randomUUID()}`
    const stage = createContext(namespace, 'leader-only')
    if (!stage.runtime)
      throw new Error('The stage synchronization runtime did not start')
    const stageRuntime = stage.runtime
    await coordinated(stageRuntime, () => stageRuntime.isLeader())
    let stageMutations = 0
    stage.store.$subscribe(() => stageMutations++, { flush: 'sync' })
    stage.store.publish('rig', [entry()])

    const settings = createContext(namespace, 'follower-only')
    if (!settings.runtime)
      throw new Error('The settings synchronization runtime did not start')
    const settingsRuntime = settings.runtime
    const loaded = received(settings.store, () => settings.store.snapshot?.modelId === 'rig')
    await coordinated(settingsRuntime, () => settingsRuntime.getLeaderId() === stageRuntime.participantId)
    await loaded
    expect(getAiriCardMappingEditor('rig', settings.store.snapshot)).toEqual({
      loaded: true,
      modelId: 'rig',
      entries: [{ id: 'smile', label: 'Smile', mappings: entry().mappings }],
    })
    expect(stageMutations).toBe(1)
    stage.store.publish('rig', [entry()])
    expect(stageMutations).toBe(1)

    // The second publication is a transport barrier: an echoed reader proposal would add a stage mutation.
    const cleared = received(settings.store, () => settings.store.snapshot === null)
    stage.store.clear('rig')
    await cleared
    expect(stageMutations).toBe(2)
    expect(getAiriCardMappingEditor('rig', settings.store.snapshot)).toEqual({ loaded: false })
  })
})
