import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DisplayModelFormat, useDisplayModelsStore } from './display-models'

const records = vi.hoisted(() => new Map<string, unknown>())
const listDeviceKeys = vi.hoisted(() => vi.fn(() => [...records.keys()]))

// Node has no IndexedDB. The `device` mount reads and writes `records` instead.
// IndexedDB returns a copy of each record, so a change is not visible until a write.
vi.mock('../database/storage', async (importOriginal) => {
  const { createStorage } = await import('unstorage')
  const storage = createStorage()
  const read = (key: string) => records.has(key) ? { ...records.get(key) as object } : null
  storage.mount('device', {
    name: 'device-records',
    hasItem: key => records.has(key),
    getItem: read,
    getItemRaw: read,
    setItemRaw: (key, value) => {
      records.set(key, value)
    },
    removeItem: (key) => {
      records.delete(key)
    },
    getKeys: listDeviceKeys,
    clear: () => records.clear(),
  })
  return { ...await importOriginal<typeof import('../database/storage')>(), storage }
})
vi.mock('@proj-airi/stage-ui-live2d/utils/live2d-zip-loader', () => ({}))
vi.mock('@proj-airi/stage-ui-live2d/utils/live2d-opfs-registration', () => ({}))
vi.mock('@proj-airi/stage-ui-live2d/utils/live2d-preview', () => ({ loadLive2DModelPreview: async () => 'live2d-preview' }))
vi.mock('@proj-airi/stage-ui-three/utils/vrm-preview', () => ({ loadVrmModelPreview: async () => 'vrm-preview' }))
vi.mock('@proj-airi/stage-ui-spine/utils/spine-preview', () => ({ loadSpineModelPreview: async () => 'spine-preview' }))
vi.mock('@proj-airi/stage-ui-tachie/utils/tachie-preview', () => ({ loadTachieModelPreview: async () => 'tachie-preview' }))
vi.mock('@proj-airi/stage-ui-mmd/utils/mmd-preview', () => ({ loadMMDModelPreview: async () => 'mmd-preview' }))

describe('display models store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    records.clear()
  })

  it('resolves newly imported display models from memory before IndexedDB', async () => {
    const store = useDisplayModelsStore()
    const model = {
      id: 'display-model-pending-idb-write',
      format: DisplayModelFormat.Live2dZip,
      type: 'file' as const,
      file: new File(['model'], 'model.zip'),
      name: 'model.zip',
      importedAt: 1,
    }

    store.displayModels = [model]

    const resolved = await store.getDisplayModel(model.id)

    expect(resolved).toEqual(model)
  })

  it('waits for the preview modules when a model is imported before startup finished initializing them', async () => {
    const store = useDisplayModelsStore()

    const model = await store.addDisplayModel(DisplayModelFormat.Live2dZip, new File(['model'], 'model.zip'))

    expect(model.previewImage).toBe('live2d-preview')
  })

  it('reports a model that is removed from this device as deleted', async () => {
    const store = useDisplayModelsStore()
    const deleted = vi.fn()
    store.onDisplayModelsDeleted(deleted)

    await store.removeDisplayModel('display-model-local')

    expect(deleted.mock.calls).toEqual([[['display-model-local']]])
  })

  it('loads stored models once when several callers initialize at the same time', async () => {
    const store = useDisplayModelsStore()

    await Promise.all([
      store.loadDisplayModelsFromIndexedDB(),
      store.loadDisplayModelsFromIndexedDB(),
      store.loadDisplayModelsFromIndexedDB(),
    ])

    expect(listDeviceKeys).toHaveBeenCalledTimes(1)
  })
})
