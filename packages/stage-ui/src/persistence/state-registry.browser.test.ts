import type { LeadershipMode } from 'pinia-plugin-synced'

import type { StateRegistration, StorageEntry, StorageLocation } from './state-registry'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { setActiveDisplayModelForSettings } from '@proj-airi/stage-shared/composables'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { useDataMaintenance } from '../composables/use-data-maintenance'
import { storage } from '../database/storage'
import { injectKeyPiniaSynced } from '../libs/pinia/synced-context'
import { useModsServerChannelStore } from '../stores/mods/api/channel-server'
import { locationMatches, resetRegisteredState, stateRegistry } from './state-registry'

// Keep the model runtime outside this test. Creating the speech store needs no model download.
vi.mock('../libs/inference/adapters/kokoro', () => ({
  getKokoroAdapter: async () => ({
    state: 'ready',
    loadModel: vi.fn(async () => undefined),
    getVoices: () => ({}),
  }),
}))

interface ObservedWrite {
  entry: StorageEntry
  /** The first stack frame outside the test and the spies, for the failure message. */
  site: string
}

const registrations: readonly StateRegistration[] = stateRegistry
const cleanups: Array<() => void | Promise<void>> = []

function siteOfWrite(): string {
  const frames = new Error('write').stack?.split('\n').slice(1) ?? []
  return frames.find(frame => !frame.includes('state-registry.browser.test') && !frame.includes('node_modules/vitest') && !frame.includes('@vitest'))?.trim() ?? 'unknown'
}

/** Records every localStorage, sessionStorage, and IndexedDB write that `run` causes. */
async function captureWrites(run: () => Promise<void>): Promise<ObservedWrite[]> {
  const writes: ObservedWrite[] = []
  const setItem = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    writes.push({ entry: { area: this === sessionStorage ? 'sessionStorage' : 'localStorage', key }, site: siteOfWrite() })
    setItem.call(this, key, value)
  })
  for (const method of ['put', 'add'] as const) {
    const original = IDBObjectStore.prototype[method]
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      writes.push({
        entry: { area: 'indexedDB', database: this.transaction.db.name, store: this.name, key: String(key) },
        site: siteOfWrite(),
      })
      return original.call(this, value, key)
    })
  }
  try {
    await run()
  }
  finally {
    vi.restoreAllMocks()
  }
  return writes
}

/** Mounts a window with real stores and a separate synchronization runtime. */
function mountWindow(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership })
  pinia.use(runtime.plugin)
  // The chat store opens the module channel. Isolate the transport and close it before teardown.
  const channel = useModsServerChannelStore(pinia)
  void channel.initialize({ connector: () => ({
    connect: () => ({ send: vi.fn(), close: vi.fn() }),
  }) })
  // Some owner stores need a component context when they are created. `useDataMaintenance`, which runs the registry,
  // creates them in the setup of its component.
  const app = createApp({
    setup() {
      useDataMaintenance()
      return () => null
    },
  })
  app.provide(injectKeyPiniaSynced, runtime)
    .use(pinia)
    .use(PiniaColada)
    .use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
    .mount(document.createElement('div'))
  cleanups.push(async () => {
    await nextTick()
    app.unmount()
    channel.dispose()
    disposePinia(pinia)
    runtime.dispose()
  })
  return { pinia, runtime }
}

function isOwned(entry: StorageEntry): boolean {
  return registrations.some(registration => registration.locations.some(
    location => (!('legacy' in location) || !location.legacy) && locationMatches(location, entry),
  ))
}

let observed: ObservedWrite[] = []

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [], data: [] })))
  // Per-model settings resolve to the scoped key of an active model.
  for (const scope of ['live2d', 'three', 'mmd', 'spine', 'tachie'] as const)
    setActiveDisplayModelForSettings(scope, `registry-model-${scope}`)
  const namespace = `state-registry:${crypto.randomUUID()}`
  // Creating every owner store writes its defaults, and each reset exercises its owner, leader-routed ones included.
  observed = await captureWrites(async () => {
    const leader = mountWindow(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    const follower = mountWindow(namespace, 'follower-only')
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
    await resetRegisteredState({ pinia: leader.pinia })
    await resetRegisteredState({ pinia: follower.pinia })
  })
}, 60_000)

afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse())
    await cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

it('creates and resets every owner without writing storage that no registration owns', () => {
  expect(observed.length).toBeGreaterThan(0)
  expect(observed.filter(write => write.entry.area === 'indexedDB').length).toBeGreaterThan(0)
  const unowned = observed.filter(write => !isOwned(write.entry)).map(write => ({ ...write.entry, site: write.site }))
  expect(unowned).toEqual([])
})

/** Entries that a location matches: the key itself, one key under a prefix, and two model-scoped keys. */
function samplesOf(location: StorageLocation): StorageEntry[] {
  switch (location.area) {
    case 'localStorage':
      if ('key' in location)
        return [{ area: 'localStorage', key: location.key }]
      if ('prefix' in location)
        return [{ area: 'localStorage', key: `${location.prefix}sample` }]
      return [
        { area: 'localStorage', key: location.perModel },
        { area: 'localStorage', key: `settings/models/model-a/${location.perModel.replace(/^settings\//, '')}` },
      ]
    case 'sessionStorage':
      return [{ area: 'sessionStorage', key: location.key }]
    case 'indexedDB':
      return 'store' in location
        ? [{ area: 'indexedDB', database: location.database, store: location.store, key: `${location.prefix ?? ''}sample` }]
        : [{ area: 'indexedDB', database: location.database, store: 'any', key: 'sample' }]
    default:
      return []
  }
}

it('gives every registration a unique id, a location, and a writer', () => {
  const ids = registrations.map(registration => registration.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(registrations.filter(registration => registration.locations.length === 0 || registration.writers.length === 0)).toEqual([])
})

it('lets no two registrations claim the same storage', () => {
  const overlaps: string[] = []
  for (const owner of registrations) {
    for (const other of registrations) {
      if (other === owner)
        continue
      for (const location of owner.locations) {
        for (const sample of samplesOf(location)) {
          if (other.locations.some(candidate => locationMatches(candidate, sample)))
            overlaps.push(`${owner.id} and ${other.id}: ${JSON.stringify(sample)}`)
        }
      }
    }
  }
  const named = registrations.flatMap(registration => registration.locations.flatMap((location) => {
    if (location.area === 'opfs')
      return ['directory' in location ? `opfs:${location.directory}` : 'opfs:display-model-caches']
    return location.area === 'cacheStorage' ? [`cache:${location.cache}`] : []
  }))
  expect(overlaps).toEqual([])
  expect(new Set(named).size).toBe(named.length)
})

it('keeps only the voiceprint deletion time and the sticker copy marker through a sweep', () => {
  const kept = registrations.flatMap(registration => registration.locations
    .filter(location => 'kept' in location && location.kept)
    .map(location => ({ id: registration.id, location })))
  expect(kept).toEqual([
    { id: 'voiceprints', location: { area: 'localStorage', key: 'settings/voice/voiceprint-deleted-at', kept: true } },
    { id: 'stickers', location: { area: 'indexedDB', database: 'airi-sticker-library', store: 'records', prefix: 'migrated-from:', kept: true } },
  ])
})

it('registers every unstorage mount', () => {
  const unregistered = storage.getMounts().flatMap(({ base, driver }) => {
    const options = driver.options as { base?: string, dbName?: string, storeName?: string } | undefined
    // The root mount keeps nothing.
    if (!options || (!options.base && !options.dbName))
      return []
    // A mount with a database of its own owns the whole store; a `base` mount writes idb-keyval's default store.
    const database = options.dbName ?? 'keyval-store'
    const store = options.storeName ?? 'keyval'
    const keyPrefix = options.dbName ? '' : `${options.base}:`
    const registered = registrations.some(registration => registration.locations.some(location =>
      location.area === 'indexedDB' && 'store' in location && location.database === database && location.store === store
      && (location.prefix ?? '').startsWith(keyPrefix)))
    return registered ? [] : [base]
  })
  expect(unregistered).toEqual([])
})

it('runs every cache registration after the durable owners', () => {
  const firstCache = registrations.findIndex(registration => registration.tier === 'cache')
  expect(firstCache).toBeGreaterThan(0)
  expect(registrations.slice(firstCache).every(registration => registration.tier === 'cache')).toBe(true)
})

it('splits mixed owners without repeating their reset or changing its order', () => {
  for (const [ownerId, splitIds] of [
    ['memory', ['memory-settings']],
    ['recipes', ['recipe-settings']],
    ['mmd', ['mmd-motion-files', 'mmd-clip-metadata']],
    ['layout-backgrounds', ['layout-background-settings']],
    ['stickers', ['sticker-settings']],
  ] as const) {
    const ownerIndex = registrations.findIndex(registration => registration.id === ownerId)
    for (const id of splitIds) {
      const splitIndex = registrations.findIndex(registration => registration.id === id)
      expect(splitIndex).toBeGreaterThan(ownerIndex)
      expect(registrations[splitIndex].reset).toBeUndefined()
    }
  }
})
