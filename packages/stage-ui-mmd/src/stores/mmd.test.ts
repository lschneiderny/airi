import type { DerivedClipMeta } from '@proj-airi/motion-driver-humanoid/clip-meta'

import { createPinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, watch } from 'vue'

// NOTICE:
// The node project has no `window`, so vueuse would skip localStorage and BroadcastChannel.
// `isClient` is read at import, and a stubbed `document` breaks `vue`, so `beforeAll` stubs, then imports the store.
// Source: @vueuse/core `defaultWindow`.
// Removal condition: this package's node project gets a DOM environment.
const storageMap = new Map<string, string>()

function installBrowserGlobals() {
  const storage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => void storageMap.set(key, value),
    removeItem: (key: string) => void storageMap.delete(key),
    clear: () => storageMap.clear(),
    key: (index: number) => [...storageMap.keys()][index] ?? null,
    get length() { return storageMap.size },
  }
  vi.stubGlobal('window', {
    localStorage: storage,
    BroadcastChannel,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  })
  vi.stubGlobal('document', {})
  vi.stubGlobal('localStorage', storage)
}

const files = vi.hoisted(() => new Map<string, unknown>())
vi.mock('localforage', () => ({
  default: {
    setItem: async (key: string, value: unknown) => void files.set(key, value),
    getItem: async (key: string) => files.get(key) ?? null,
    removeItem: async (key: string) => void files.delete(key),
  },
}))

const MODEL = 'model-a'

function meta(name: string, kind: DerivedClipMeta['kind'], layer: DerivedClipMeta['layer']): DerivedClipMeta & { name: string } {
  return { name, kind, layer, loop: false, durationMs: 2000, label: name, notes: [] }
}

function vmd(name: string) {
  return new File(['x'], `${name}.vmd`)
}

let useMMD: typeof import('./mmd').useMMD
let pinias: ReturnType<typeof createPinia>[] = []

function freshStore() {
  const pinia = createPinia()
  pinias.push(pinia)
  return useMMD(pinia)
}

beforeAll(async () => {
  installBrowserGlobals()
  ;({ useMMD } = await import('./mmd'))
})

beforeEach(() => {
  storageMap.clear()
  files.clear()
  pinias = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function importWithMeta(store: ReturnType<typeof freshStore>, name: string, kind: DerivedClipMeta['kind'], layer: DerivedClipMeta['layer']) {
  await store.addMotion(vmd(name))
  store.availableClipMeta = { ...store.availableClipMeta, [name]: meta(name, kind, layer) }
}

describe('mmd clip curation store', () => {
  it('round-trips curation through localStorage and keeps it across a re-import of the same name', async () => {
    const store = freshStore()
    await store.addMotion(vmd('wave'))
    expect(store.setCuration(MODEL, 'wave', { label: 'wave', aiMayUse: true, loop: true })).toBe(true)
    await nextTick()

    const peer = freshStore()
    expect(peer.curationFor(MODEL, 'wave')).toEqual({ label: 'wave', kind: null, loop: true, aiMayUse: true })
    expect(peer.curationFor(MODEL, 'unknown')).toEqual({ label: null, kind: null, loop: null, aiMayUse: false })

    await store.addMotion(vmd('wave'))
    expect(store.curationFor(MODEL, 'wave').label).toBe('wave')
  })

  it('refuses a duplicate label within a model and leaves the state untouched', async () => {
    const store = freshStore()
    await store.addMotion(vmd('wave'))
    await store.addMotion(vmd('bow'))
    expect(store.setCuration(MODEL, 'wave', { label: 'greet' })).toBe(true)
    expect(store.setCuration(MODEL, 'bow', { label: 'greet', aiMayUse: true })).toBe(false)
    expect(store.curationFor(MODEL, 'bow')).toEqual({ label: null, kind: null, loop: null, aiMayUse: false })
    expect(store.setCuration(MODEL, 'wave', { label: 'greet', aiMayUse: true })).toBe(true)
    expect(store.setCuration('model-b', 'bow', { label: 'greet' })).toBe(true)
  })

  it('refuses labels that fail CLIP_LABEL_PATTERN, including the empty string and a case-only variant', async () => {
    const store = freshStore()
    await store.addMotion(vmd('wave'))
    expect(store.setCuration(MODEL, 'wave', { label: 'wave' })).toBe(true)
    expect(store.setCuration(MODEL, 'wave', { label: '' })).toBe(false)
    expect(store.setCuration(MODEL, 'wave', { label: 'Wave' })).toBe(false)
    expect(store.setCuration(MODEL, 'wave', { label: 'has space' })).toBe(false)
    expect(store.setCuration(MODEL, 'wave', { label: 'a'.repeat(33) })).toBe(false)
    expect(store.curationFor(MODEL, 'wave').label).toBe('wave')
    expect(store.setCuration(MODEL, 'wave', { label: null })).toBe(true)
    expect(store.curationFor(MODEL, 'wave').label).toBeNull()
  })

  it('exposes only labeled, exposed gesture/action/dance clips', async () => {
    const store = freshStore()
    await importWithMeta(store, 'wave', 'gesture', 'upper')
    await importWithMeta(store, 'spin', 'action', 'full')
    await importWithMeta(store, 'hidden', 'dance', 'full')
    await importWithMeta(store, 'unlabeled', 'gesture', 'upper')
    await importWithMeta(store, 'idle', 'stance', 'upper')
    await importWithMeta(store, 'broken', 'unusable', 'none')
    store.setCuration(MODEL, 'wave', { label: 'wave', aiMayUse: true })
    store.setCuration(MODEL, 'spin', { label: 'spin', aiMayUse: true })
    store.setCuration(MODEL, 'hidden', { label: 'hidden' })
    store.setCuration(MODEL, 'unlabeled', { aiMayUse: true })
    store.setCuration(MODEL, 'idle', { label: 'idle', aiMayUse: true })
    store.setCuration(MODEL, 'broken', { label: 'broken', aiMayUse: true })

    expect(store.labeledClips(MODEL).map(clip => clip.name)).toEqual(['wave', 'spin', 'hidden'])
    expect(store.exposedActions(MODEL)).toEqual([
      { name: 'wave', label: 'wave', kind: 'gesture', layer: 'upper', exposed: true },
      { name: 'spin', label: 'spin', kind: 'action', layer: 'full', exposed: true },
    ])
    expect(store.exposedActions('model-b')).toEqual([])
  })

  it('applies a kind override to the listed kind and layer', async () => {
    const store = freshStore()
    await importWithMeta(store, 'long-wave', 'action', 'upper')
    store.setCuration(MODEL, 'long-wave', { label: 'long-wave', kind: 'gesture', aiMayUse: true })
    expect(store.exposedActions(MODEL)).toEqual([
      { name: 'long-wave', label: 'long-wave', kind: 'gesture', layer: 'upper', exposed: true },
    ])
  })

  it('clears curation and derived meta when the clip is removed, leaving other clips alone', async () => {
    const store = freshStore()
    await importWithMeta(store, 'wave', 'gesture', 'upper')
    await importWithMeta(store, 'bow', 'gesture', 'upper')
    store.setCuration(MODEL, 'wave', { label: 'wave', aiMayUse: true })
    store.setCuration(MODEL, 'bow', { label: 'bow', aiMayUse: true })
    const id = store.availableMotions.find(motion => motion.name === 'wave')!.id

    await store.removeMotion(id)

    expect(store.curationFor(MODEL, 'wave')).toEqual({ label: null, kind: null, loop: null, aiMayUse: false })
    expect(store.availableClipMeta.wave).toBeUndefined()
    expect(store.curationFor(MODEL, 'bow').label).toBe('bow')
    expect(store.availableClipMeta.bow).toBeDefined()
  })

  it('delivers requestPerform to a second store instance over the BroadcastChannel', async () => {
    const sender = freshStore()
    const receiver = freshStore()
    const received = new Promise<unknown>((resolve, reject) => {
      const signal = AbortSignal.timeout(2000)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      watch(() => receiver.performRequest, request => request && resolve(request), { flush: 'sync' })
    })

    sender.requestPerform('wave', { loop: true, source: 'lab' })

    expect(await received).toEqual({ name: 'wave', loop: true, source: 'lab', nonce: 1 })
    expect(sender.performRequest?.nonce).toBe(1)
    sender.requestPerform(null, { source: 'lab' })
    expect(sender.performRequest).toEqual({ name: null, loop: false, source: 'lab', nonce: 2 })
  })

  it('records what a corrupted clip-curation value does', () => {
    storageMap.set('settings/mmd/clip-curation', '{not json')
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = freshStore()
    expect(reported).toHaveBeenCalledTimes(1)
    expect(store.curationFor(MODEL, 'wave')).toEqual({ label: null, kind: null, loop: null, aiMayUse: false })
    expect(store.setCuration(MODEL, 'wave', { label: 'wave' })).toBe(true)
    expect(store.curationFor(MODEL, 'wave').label).toBe('wave')
  })
})
