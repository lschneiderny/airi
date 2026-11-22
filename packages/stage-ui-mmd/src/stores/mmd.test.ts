// @vitest-environment jsdom

import type { DerivedClipMeta } from '@proj-airi/motion-driver-humanoid/clip-meta'

import { resetModelScopedLocalStorageForTesting } from '@proj-airi/stage-shared/composables'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useMMD } from './mmd'
import { useMMDPerformanceSettings } from './performance-settings'

// Node has no IndexedDB. An in-memory driver replaces the store of the motion files.
const files = vi.hoisted(() => ({ clear: () => {} }))
vi.mock('unstorage/drivers/indexedb', async () => {
  const { default: memoryDriver } = await import('unstorage/drivers/memory')
  return {
    default: () => {
      const driver = memoryDriver()
      files.clear = () => void driver.clear?.('', {})
      return driver
    },
  }
})

const MODEL = 'model-a'

function meta(name: string, kind: DerivedClipMeta['kind'], layer: DerivedClipMeta['layer']): DerivedClipMeta & { name: string } {
  return { name, kind, layer, loop: false, durationMs: 2000, label: name, notes: [] }
}

function vmd(name: string) {
  return new File(['x'], `${name}.vmd`)
}

let pinias: ReturnType<typeof createPinia>[] = []

function freshStore() {
  const pinia = createPinia()
  pinias.push(pinia)
  return { motions: useMMD(pinia), settings: useMMDPerformanceSettings(pinia) }
}

beforeEach(() => {
  localStorage.clear()
  resetModelScopedLocalStorageForTesting()
  files.clear()
  pinias = []
})

afterEach(() => {
  pinias.forEach(disposePinia)
  vi.restoreAllMocks()
})

async function importWithMeta(store: ReturnType<typeof freshStore>, name: string, kind: DerivedClipMeta['kind'], layer: DerivedClipMeta['layer']) {
  await store.motions.addMotion(vmd(name))
  store.motions.availableClipMeta = { ...store.motions.availableClipMeta, [name]: meta(name, kind, layer) }
}

describe('mmd clip curation store', () => {
  it('round-trips curation through localStorage and keeps it across a re-import of the same name', async () => {
    const store = freshStore()
    await store.motions.addMotion(vmd('wave'))
    expect(await store.settings.setCuration(MODEL, 'wave', { label: 'wave', aiMayUse: true, loop: true })).toBe(true)
    await nextTick()

    const peer = freshStore()
    expect(peer.settings.curationFor(MODEL, 'wave')).toEqual({ label: 'wave', kind: null, loop: true, aiMayUse: true, idleMayUse: false })
    expect(peer.settings.curationFor(MODEL, 'unknown')).toEqual({ label: null, kind: null, loop: null, aiMayUse: false, idleMayUse: false })

    await store.motions.addMotion(vmd('wave'))
    expect(store.settings.curationFor(MODEL, 'wave').label).toBe('wave')
  })

  it('refuses a duplicate label within a model and leaves the state untouched', async () => {
    const store = freshStore()
    await store.motions.addMotion(vmd('wave'))
    await store.motions.addMotion(vmd('bow'))
    expect(await store.settings.setCuration(MODEL, 'wave', { label: 'greet' })).toBe(true)
    expect(await store.settings.setCuration(MODEL, 'bow', { label: 'greet', aiMayUse: true })).toBe(false)
    expect(store.settings.curationFor(MODEL, 'bow')).toEqual({ label: null, kind: null, loop: null, aiMayUse: false, idleMayUse: false })
    expect(await store.settings.setCuration(MODEL, 'wave', { label: 'greet', aiMayUse: true })).toBe(true)
    expect(await store.settings.setCuration('model-b', 'bow', { label: 'greet' })).toBe(true)
  })

  it('refuses labels that fail CLIP_LABEL_PATTERN, including the empty string and a case-only variant', async () => {
    const store = freshStore()
    await store.motions.addMotion(vmd('wave'))
    expect(await store.settings.setCuration(MODEL, 'wave', { label: 'wave' })).toBe(true)
    expect(await store.settings.setCuration(MODEL, 'wave', { label: '' })).toBe(false)
    expect(await store.settings.setCuration(MODEL, 'wave', { label: 'Wave' })).toBe(false)
    expect(await store.settings.setCuration(MODEL, 'wave', { label: 'has space' })).toBe(false)
    expect(await store.settings.setCuration(MODEL, 'wave', { label: 'a'.repeat(33) })).toBe(false)
    expect(store.settings.curationFor(MODEL, 'wave').label).toBe('wave')
    expect(await store.settings.setCuration(MODEL, 'wave', { label: null })).toBe(true)
    expect(store.settings.curationFor(MODEL, 'wave').label).toBeNull()
  })

  it('exposes only labeled, exposed gesture/action/dance clips', async () => {
    const store = freshStore()
    await importWithMeta(store, 'wave', 'gesture', 'upper')
    await importWithMeta(store, 'spin', 'action', 'full')
    await importWithMeta(store, 'hidden', 'dance', 'full')
    await importWithMeta(store, 'unlabeled', 'gesture', 'upper')
    await importWithMeta(store, 'idle', 'stance', 'upper')
    await importWithMeta(store, 'broken', 'unusable', 'none')
    await store.settings.setCuration(MODEL, 'wave', { label: 'wave', aiMayUse: true })
    await store.settings.setCuration(MODEL, 'spin', { label: 'spin', aiMayUse: true })
    await store.settings.setCuration(MODEL, 'hidden', { label: 'hidden' })
    await store.settings.setCuration(MODEL, 'unlabeled', { aiMayUse: true })
    await store.settings.setCuration(MODEL, 'idle', { label: 'idle', aiMayUse: true })
    await store.settings.setCuration(MODEL, 'broken', { label: 'broken', aiMayUse: true })

    expect(store.settings.labeledClips(MODEL, store.motions.availableMotions, store.motions.availableClipMeta).map(clip => clip.name)).toEqual(['wave', 'spin', 'hidden'])
    expect(store.settings.exposedActions(MODEL, store.motions.availableMotions, store.motions.availableClipMeta)).toEqual([
      { name: 'wave', label: 'wave', kind: 'gesture', layer: 'upper', exposed: true, idle: false },
      { name: 'spin', label: 'spin', kind: 'action', layer: 'full', exposed: true, idle: false },
    ])
    expect(store.settings.exposedActions('model-b', store.motions.availableMotions, store.motions.availableClipMeta)).toEqual([])
  })

  it('applies a kind override to the listed kind and layer', async () => {
    const store = freshStore()
    await importWithMeta(store, 'long-wave', 'action', 'upper')
    await store.settings.setCuration(MODEL, 'long-wave', { label: 'long-wave', kind: 'gesture', aiMayUse: true })
    expect(store.settings.exposedActions(MODEL, store.motions.availableMotions, store.motions.availableClipMeta)).toEqual([
      { name: 'long-wave', label: 'long-wave', kind: 'gesture', layer: 'upper', exposed: true, idle: false },
    ])
  })

  it('clears curation and derived meta when the clip is removed, leaving other clips alone', async () => {
    const store = freshStore()
    await importWithMeta(store, 'wave', 'gesture', 'upper')
    await importWithMeta(store, 'bow', 'gesture', 'upper')
    await store.settings.setCuration(MODEL, 'wave', { label: 'wave', aiMayUse: true })
    await store.settings.setCuration(MODEL, 'bow', { label: 'bow', aiMayUse: true })
    const id = store.motions.availableMotions.find(motion => motion.name === 'wave')!.id

    await store.motions.removeMotion(id)

    expect(store.settings.curationFor(MODEL, 'wave')).toEqual({ label: null, kind: null, loop: null, aiMayUse: false, idleMayUse: false })
    expect(store.motions.availableClipMeta.wave).toBeUndefined()
    expect(store.settings.curationFor(MODEL, 'bow').label).toBe('bow')
    expect(store.motions.availableClipMeta.bow).toBeDefined()
  })

  it('lists a clip as allowed for idle, and reads a record saved before the field existed as not allowed', async () => {
    localStorage.setItem('settings/mmd/clip-curation', JSON.stringify({ [MODEL]: { wave: { label: 'wave', kind: null, loop: null, aiMayUse: true } } }))
    const store = freshStore()
    await importWithMeta(store, 'wave', 'gesture', 'upper')
    expect(store.settings.curationFor(MODEL, 'wave')).toEqual({ label: 'wave', kind: null, loop: null, aiMayUse: true, idleMayUse: false })
    expect(store.settings.labeledClips(MODEL, store.motions.availableMotions, store.motions.availableClipMeta)).toEqual([{ name: 'wave', label: 'wave', kind: 'gesture', layer: 'upper', exposed: true, idle: false }])

    expect(await store.settings.setCuration(MODEL, 'wave', { idleMayUse: true })).toBe(true)
    expect(store.settings.labeledClips(MODEL, store.motions.availableMotions, store.motions.availableClipMeta)[0]).toMatchObject({ exposed: true, idle: true })
  })

  it('keeps valid siblings when old clip curation is corrupt', async () => {
    localStorage.setItem('settings/mmd/clip-curation', '{not json')
    localStorage.setItem('settings/mmd/stage-character-height', '700')
    const store = freshStore()
    expect(store.settings.stageCharacterHeight).toBe(700)
    expect(store.settings.curationFor(MODEL, 'wave')).toEqual({ label: null, kind: null, loop: null, aiMayUse: false, idleMayUse: false })
    expect(await store.settings.setCuration(MODEL, 'wave', { label: 'wave' })).toBe(true)
    expect(store.settings.curationFor(MODEL, 'wave').label).toBe('wave')
  })
})
