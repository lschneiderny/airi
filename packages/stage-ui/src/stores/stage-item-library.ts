import type { StageItemFileRefusal } from '@proj-airi/stage-ui-live2d/utils/stage-item-validator'

import type { StageItemAsset } from '../database/repos/stage-items.repo'

import { inspectStageItemFile } from '@proj-airi/stage-ui-live2d/utils/stage-item-validator'
import { createEventHook } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { onScopeDispose, ref, shallowRef } from 'vue'

import * as v from 'valibot'

import { stageItemsRepo } from '../database/repos/stage-items.repo'

export type StageItemImportRefusal = StageItemFileRefusal | 'library-full' | 'storage-full'

export type StageItemImportResult
  = | { ok: true, asset: StageItemAsset }
    | { ok: false, name: string, reason: StageItemImportRefusal }

/** The library holds at most this many assets; a further import is refused `library-full`. */
const MAX_LIBRARY_ASSETS = 200

/** A change notice between windows. It carries ids only, never file bytes; `removed` names deleted assets. */
const LibraryMessageSchema = v.object({ removed: v.optional(v.array(v.string())) })
type LibraryMessage = v.InferOutput<typeof LibraryMessageSchema>

function isQuotaExceeded(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
}

/**
 * The device-wide stage item library. IndexedDB owns it, and any window may write it: writes take the repository's
 * Web Lock, and each write invalidates the other windows over the `airi:stage-item-library` BroadcastChannel.
 */
export const useStageItemLibraryStore = defineStore('stage-item-library', () => {
  const assets = shallowRef<StageItemAsset[]>([])
  const error = ref(false)
  const assetsRemoved = createEventHook<readonly string[]>()
  const channel = new BroadcastChannel('airi:stage-item-library')
  let disposed = false
  let pendingLoad = Promise.resolve()

  /** Every awaited load includes the writes that finished before it was called. */
  function load() {
    pendingLoad = pendingLoad.catch(() => {}).then(async () => {
      try {
        const list = await stageItemsRepo.list()
        if (disposed)
          return
        assets.value = list.sort((a, b) => a.importedAt - b.importedAt || a.id.localeCompare(b.id))
        error.value = false
      }
      catch (cause) {
        error.value = true
        throw cause
      }
    })
    return pendingLoad
  }

  function publish(message: LibraryMessage) {
    channel.postMessage(message)
  }

  /** Reports removals after `assets` already excludes them, so a listener reads a consistent library. */
  async function reportRemoved(ids: readonly string[]) {
    await load().catch(() => {})
    if (ids.length > 0)
      await assetsRemoved.trigger(ids)
  }

  async function importFile(file: File): Promise<StageItemImportResult> {
    const inspection = await inspectStageItemFile(file)
    if (!inspection.ok)
      return { ok: false, name: file.name, reason: inspection.reason }
    const asset: StageItemAsset = { id: `asset-${nanoid()}`, name: file.name, ...inspection.info, importedAt: Date.now() }
    try {
      if (!await stageItemsRepo.add(asset, file, MAX_LIBRARY_ASSETS))
        return { ok: false, name: file.name, reason: 'library-full' }
    }
    catch (cause) {
      if (isQuotaExceeded(cause))
        return { ok: false, name: file.name, reason: 'storage-full' }
      throw cause
    }
    return { ok: true, asset }
  }

  /** Imports each file in order and returns one result per file. A refused file does not stop the others. */
  async function importFiles(files: readonly File[]): Promise<StageItemImportResult[]> {
    const results: StageItemImportResult[] = []
    for (const file of files)
      results.push(await importFile(file))
    if (results.some(result => result.ok)) {
      await load()
      publish({})
    }
    return results
  }

  async function remove(id: string) {
    if (!await stageItemsRepo.remove(id))
      return
    publish({ removed: [id] })
    await reportRemoved([id])
  }

  function blobOf(id: string): Promise<Blob | null> {
    return stageItemsRepo.file(id)
  }

  /** Empties the library for "Delete all data", and tells every window which assets went away. */
  async function resetState() {
    const removed = await stageItemsRepo.clear()
    publish({ removed })
    await reportRemoved(removed)
  }

  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = v.safeParse(LibraryMessageSchema, event.data)
    if (!message.success)
      return
    // A failed load sets `error`, which the library UI shows.
    void reportRemoved(message.output.removed ?? [])
  })
  void load().catch(() => {})
  onScopeDispose(() => {
    disposed = true
    channel.close()
  })

  return {
    assets,
    error,
    load,
    importFiles,
    remove,
    blobOf,
    resetState,
    /** Fires with the ids of removed assets, for removals in this window and in others. */
    onAssetsRemoved: assetsRemoved.on,
  }
})
