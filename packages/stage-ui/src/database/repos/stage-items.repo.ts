import type { StageItemFileInfo } from '@proj-airi/stage-ui-live2d/utils/stage-item-validator'

import { prefixStorage } from 'unstorage'

import { listRawItems, storage } from '../storage'

/** Serializes library writes across windows, so the size check and the write of one import see the same library. */
const WRITE_LOCK = 'airi:stage-item-library-write'

/**
 * One file in the device-wide item library. The id is stable and separate from any model's placement of it, so a
 * placement, and later an ownership record, refers to the asset by id alone.
 */
export interface StageItemAsset extends StageItemFileInfo {
  id: string
  /** The imported file's name, shown as plain text. */
  name: string
  importedAt: number
}

const entries = prefixStorage(storage, 'stage-items:entries')
const files = prefixStorage(storage, 'stage-items:files')

export const stageItemsRepo = {
  async list(): Promise<StageItemAsset[]> {
    return (await listRawItems<StageItemAsset>(entries, '')).map(([, asset]) => asset)
  },
  async file(id: string): Promise<Blob | null> {
    return files.getItemRaw<Blob>(id)
  },
  /**
   * Stores the file, then its entry, unless the library already holds `maxAssets` entries; returns whether it stored
   * them. A failed write, such as a `QuotaExceededError`, removes both before it rethrows, so no entry points to a
   * missing file and no file stays without an entry.
   */
  async add(asset: StageItemAsset, file: Blob, maxAssets: number): Promise<boolean> {
    return navigator.locks.request(WRITE_LOCK, async () => {
      if ((await entries.getKeys()).length >= maxAssets)
        return false
      try {
        await files.setItemRaw(asset.id, file)
        await entries.setItemRaw(asset.id, asset)
      }
      catch (error) {
        await Promise.all([files.removeItem(asset.id), entries.removeItem(asset.id)])
        throw error
      }
      return true
    })
  },
  async remove(id: string): Promise<boolean> {
    return navigator.locks.request(WRITE_LOCK, async () => {
      const existed = await entries.hasItem(id)
      await entries.removeItem(id)
      await files.removeItem(id)
      return existed
    })
  },
  async clear(): Promise<string[]> {
    return navigator.locks.request(WRITE_LOCK, async () => {
      const ids = await entries.getKeys()
      // Orphaned files too: an import interrupted between its two writes leaves a file without an entry.
      const fileIds = await files.getKeys()
      await Promise.all([...ids.map(id => entries.removeItem(id)), ...fileIds.map(id => files.removeItem(id))])
      return ids
    })
  },
}
