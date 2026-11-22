import type { DerivedClipMeta } from '@proj-airi/motion-driver-humanoid/clip-meta'
import type {} from 'pinia-plugin-synced'

import { modelScopedStorageKey } from '@proj-airi/stage-shared/composables'
import { omit } from 'es-toolkit'
import { defineStore } from 'pinia'
import { computed, shallowRef, toRaw } from 'vue'

export type MMDClipMetadata = Record<string, DerivedClipMeta & { name: string }>

export interface MMDClipSnapshot {
  modelId: string | null
  loadEpoch: number
  clips: MMDClipMetadata
}

const legacyKey = 'settings/mmd/available-clip-meta'

// NOTICE:
// Derived catalogs from older releases are discarded, never imported as user curation.
// Root cause: the old MMD store persisted data that the stage rebuilds from loaded clips.
// Source: packages/stage-ui-mmd/src/stores/mmd.ts before S2.
// Removal condition: no supported release writes settings/mmd/available-clip-meta or its model-scoped keys.
function removeLegacyMetadata() {
  if (typeof localStorage === 'undefined')
    return
  localStorage.removeItem(legacyKey)
  for (const key of Object.keys(localStorage)) {
    const match = key.match(/^settings\/models\/([^/]+)\/mmd\/available-clip-meta$/)
    if (match)
      localStorage.removeItem(modelScopedStorageKey(match[1], legacyKey))
  }
}

/**
 * Tier 5: the stage is the only catalog producer. beginLoad, publish, and invalidate run in that renderer;
 * other windows only read snapshots. User reset and removal commands route to the leader.
 * Every model/library load gets a new epoch. A completion from a replaced or reset load cannot publish again.
 */
export const useMMDClipMetadata = defineStore('mmd-clip-metadata', () => {
  const snapshot = shallowRef<MMDClipSnapshot>({ modelId: null, loadEpoch: 0, clips: {} })
  const clipFor = computed(() => (modelId: string, name: string) => {
    const current = snapshot.value
    return current.modelId === modelId && Object.hasOwn(current.clips, name) ? current.clips[name] : undefined
  })

  function beginLoad(modelId: string): number {
    const loadEpoch = snapshot.value.loadEpoch + 1
    snapshot.value = { modelId, loadEpoch, clips: {} }
    return loadEpoch
  }

  function publish(modelId: string, loadEpoch: number, clip: DerivedClipMeta & { name: string }): boolean {
    const current = snapshot.value
    if (current.modelId !== modelId || current.loadEpoch !== loadEpoch)
      return false
    snapshot.value = { ...current, clips: { ...current.clips, [clip.name]: structuredClone(toRaw(clip)) } }
    return true
  }

  function invalidate(modelId: string, loadEpoch: number) {
    if (snapshot.value.modelId !== modelId || snapshot.value.loadEpoch !== loadEpoch)
      return
    snapshot.value = { modelId: null, loadEpoch: loadEpoch + 1, clips: {} }
  }

  async function initialize() {
    removeLegacyMetadata()
  }

  async function reset() {
    snapshot.value = { modelId: null, loadEpoch: snapshot.value.loadEpoch + 1, clips: {} }
    removeLegacyMetadata()
  }

  async function removeModel(modelId: string) {
    if (snapshot.value.modelId === modelId)
      await reset()
  }

  async function removeClip(name: string) {
    const current = snapshot.value
    if (current.modelId === null)
      return
    // Invalidate in-flight clip loads before the motion owner changes its list. The stage then starts a new epoch
    // for that list, republishing cached clips as well as newly loaded ones.
    snapshot.value = { ...current, loadEpoch: current.loadEpoch + 1, clips: omit(current.clips, [name]) }
  }

  return { snapshot, clipFor, beginLoad, publish, invalidate, initialize, reset, removeModel, removeClip }
}, {
  synced: { state: true, actions: ['initialize', 'reset', 'removeModel', 'removeClip'] },
})
