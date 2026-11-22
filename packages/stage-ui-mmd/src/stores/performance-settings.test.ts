// @vitest-environment jsdom

import { resetModelScopedLocalStorageForTesting, setActiveDisplayModelForSettings } from '@proj-airi/stage-shared/composables'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'

import { useMMDClipMetadata } from './clip-metadata'
import { useMMDPerformanceSettings } from './performance-settings'

const key = 'settings/mmd/performance'
const contexts: ReturnType<typeof createPinia>[] = []
function context() {
  const pinia = createPinia()
  contexts.push(pinia)
  return useMMDPerformanceSettings(pinia)
}
function oldDriver(id: string, driver: string) {
  localStorage.setItem(`settings/models/${id}/mmd/motion-driver`, driver)
}

afterEach(() => {
  contexts.splice(0).forEach(disposePinia)
  resetModelScopedLocalStorageForTesting()
  localStorage.clear()
  vi.restoreAllMocks()
})

it('imports every inactive model and preserves curation, empty maps, and false permissions', async () => {
  oldDriver('model-a', 'classic')
  oldDriver('model-b', 'natural')
  localStorage.setItem('settings/mmd/stage-character-height', '700')
  localStorage.setItem('settings/mmd/roam-mode', 'stay')
  const slots = { 'model-a': { idle: 'rest' }, 'model-b': { sleep: 'sleep' } }
  const clips = { 'model-a': { wave: { label: null, kind: 'gesture', loop: false, aiMayUse: false, idleMayUse: false } }, 'model-b': {} }
  localStorage.setItem('settings/mmd/stance-slots', JSON.stringify(slots))
  localStorage.setItem('settings/mmd/clip-curation', JSON.stringify(clips))
  localStorage.setItem('settings/models/model-a/mmd/physics-enabled', 'false')
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  const store = context()
  expect(writes).not.toHaveBeenCalled()
  await store.initialize()
  expect(store.document.motionDrivers).toEqual({ 'model-a': 'classic', 'model-b': 'natural' })
  expect(store.stageCharacterHeight).toBe(700)
  expect(store.roamMode).toBe('stay')
  expect(store.stanceSlots).toEqual(slots)
  expect(store.clipCuration).toEqual(clips)
  expect(writes.mock.calls.filter(([name]) => name === key)).toHaveLength(1)
  expect(Object.keys(localStorage).sort()).toEqual([key, 'settings/models/model-a/mmd/physics-enabled'])
})

it('keeps an unscoped driver until the first eligible model and consumes it only once', async () => {
  localStorage.setItem('settings/mmd/motion-driver', 'classic')
  const store = context()
  await store.initialize()
  expect(store.document.unassignedMotionDriver).toBe('classic')
  expect(localStorage.getItem('settings/mmd/motion-driver')).toBeNull()
  await store.selectModel('model-a')
  await store.selectModel('model-b')
  expect(store.document.motionDrivers).toEqual({ 'model-a': 'classic' })
  expect(JSON.parse(localStorage.getItem(key)!)).not.toHaveProperty('unassignedMotionDriver')
})

it('keeps a scoped active choice and reserves the old unscoped choice for another model', async () => {
  oldDriver('model-a', 'natural')
  localStorage.setItem('settings/mmd/motion-driver', 'classic')
  setActiveDisplayModelForSettings('mmd', 'model-a')
  const store = context()
  await store.initialize()
  expect(store.motionDriver).toBe('natural')
  expect(store.document.unassignedMotionDriver).toBe('classic')
  await store.selectModel('model-b')
  expect(store.document.motionDrivers).toEqual({ 'model-a': 'natural', 'model-b': 'classic' })
})

it('claims the unscoped driver during initialization when an eligible model is already active', async () => {
  localStorage.setItem('settings/mmd/motion-driver', 'classic')
  setActiveDisplayModelForSettings('mmd', 'model-a')
  const store = context()
  await store.initialize()
  expect(store.motionDriver).toBe('classic')
  expect(store.document.unassignedMotionDriver).toBeUndefined()
})

it('resets only corrupt fields and keeps valid siblings within maps', async () => {
  oldDriver('model-a', 'broken')
  oldDriver('model-b', 'classic')
  localStorage.setItem('settings/mmd/stage-character-height', '0')
  localStorage.setItem('settings/mmd/roam-mode', 'roam')
  localStorage.setItem('settings/mmd/clip-curation', JSON.stringify({ 'model-a': { wave: { label: 'wave', kind: 'broken', loop: false, aiMayUse: true, idleMayUse: false } } }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const store = context()
  await store.initialize()
  expect(store.document.motionDrivers).toEqual({ 'model-a': 'natural', 'model-b': 'classic' })
  expect(store.stageCharacterHeight).toBe(560)
  expect(store.roamMode).toBe('roam')
  expect(store.curationFor('model-a', 'wave')).toEqual({ label: 'wave', kind: null, loop: false, aiMayUse: true, idleMayUse: false })
})

it('prefers an existing document, including empty maps, over every old key', async () => {
  localStorage.setItem(key, JSON.stringify({ motionDrivers: {}, stanceSlots: {}, clipCuration: {}, roamMode: 'stay', stageCharacterHeight: 560 }))
  oldDriver('model-a', 'classic')
  localStorage.setItem('settings/mmd/roam-mode', 'roam')
  const reads = vi.spyOn(Storage.prototype, 'getItem')
  const store = context()
  expect(reads.mock.calls.some(([name]) => name === 'settings/mmd/roam-mode')).toBe(false)
  await store.initialize()
  expect(store.document.motionDrivers).toEqual({})
  expect(store.roamMode).toBe('stay')
  expect(localStorage.getItem('settings/models/model-a/mmd/motion-driver')).toBeNull()
})

it('retains all old keys when a document save fails', async () => {
  oldDriver('model-a', 'classic')
  localStorage.setItem('settings/mmd/roam-mode', 'roam')
  const store = context()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Save refused')
  })
  await expect(store.initialize()).rejects.toThrow('Save refused')
  expect(localStorage.getItem(key)).toBeNull()
  expect(localStorage.getItem('settings/models/model-a/mmd/motion-driver')).toBe('classic')
  expect(localStorage.getItem('settings/mmd/roam-mode')).toBe('roam')
})

it('resets to defaults instead of importing and cannot resurrect old keys after a sweep', async () => {
  oldDriver('model-a', 'classic')
  oldDriver('model-b', 'natural')
  localStorage.setItem('settings/mmd/motion-driver', 'classic')
  localStorage.setItem('settings/mmd/stage-character-height', '700')
  const store = context()
  await store.reset()
  expect(store.stageCharacterHeight).toBe(560)
  expect(store.document.motionDrivers).toEqual({})
  expect(store.document.unassignedMotionDriver).toBeUndefined()
  expect(Object.keys(localStorage)).toEqual([key])
  localStorage.removeItem(key)
  expect(context().document.motionDrivers).toEqual({})
})

it('enforces labels and kind permissions in the action and makes repeated edits side-effect free', async () => {
  const store = context()
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  expect(await store.setCuration('model-a', 'wave', { label: 'wave', aiMayUse: true })).toBe(true)
  expect(await store.setCuration('model-a', 'wave', { label: 'wave', aiMayUse: true })).toBe(true)
  expect(writes).toHaveBeenCalledTimes(1)
  expect(await store.setCuration('model-a', 'bow', { label: 'wave' })).toBe(false)
  await store.setCuration('model-a', 'wave', { kind: 'stance', aiMayUse: true, idleMayUse: true })
  expect(store.curationFor('model-a', 'wave').aiMayUse).toBe(false)
  expect(store.curationFor('model-a', 'wave').idleMayUse).toBe(false)
  const metadata = useMMDClipMetadata(contexts.at(-1)!)
  const epoch = metadata.beginLoad('model-a')
  metadata.publish('model-a', epoch, { name: 'wave', label: 'wave', kind: 'unusable', layer: 'none', loop: false, durationMs: 0, notes: ['bad-duration'] })
  await store.setCuration('model-a', 'wave', { kind: null, aiMayUse: true })
  expect(store.curationFor('model-a', 'wave').aiMayUse).toBe(false)
})

it('accepts only scalar patches and removes one model without changing another', async () => {
  const store = context()
  await store.setMotionDriver('model-a', 'classic')
  await store.setMotionDriver('model-b', 'natural')
  await store.setStanceSlot('model-a', 'idle', 'rest')
  await store.setStanceSlot('model-b', 'sleep', 'sleep')
  await store.setCuration('model-a', 'wave', { label: 'wave' })
  await store.setCuration('model-b', 'bow', { label: 'bow' })
  // @ts-expect-error A follower must not propose an entire map through update.
  expect((await store.update({ motionDrivers: {} })).success).toBe(false)
  await store.removeModel('model-a')
  expect(store.document.motionDrivers).toEqual({ 'model-b': 'natural' })
  expect(store.stanceSlots).toEqual({ 'model-b': { sleep: 'sleep' } })
  expect(Object.keys(store.clipCuration)).toEqual(['model-b'])
  await store.setStanceSlot('model-b', 'sleep', null)
  expect(store.stanceSlots['model-b']).toEqual({})
})

it('treats arbitrary clip names as dictionary keys rather than inherited properties', async () => {
  const store = context()
  setActiveDisplayModelForSettings('mmd', 'constructor')
  expect(store.motionDriver).toBe('natural')
  await store.setCuration('model-a', 'wave', { label: 'wave' })
  expect(store.curationFor('model-a', 'constructor')).toEqual({ label: null, kind: null, loop: null, aiMayUse: false, idleMayUse: false })
})

it('offers a curated constructor-named clip only after its metadata was published', async () => {
  const store = context()
  const metadata = useMMDClipMetadata(contexts.at(-1)!)
  const epoch = metadata.beginLoad('model-a')
  await store.setCuration('model-a', 'constructor', { label: 'constructor', kind: 'gesture', aiMayUse: true })
  expect(store.exposedActions('model-a', [{ name: 'constructor' }])).toEqual([])
  metadata.publish('model-a', epoch, { name: 'constructor', label: 'constructor', kind: 'gesture', layer: 'upper', loop: false, durationMs: 2000, notes: [] })
  expect(store.exposedActions('model-a', [{ name: 'constructor' }]).map(clip => clip.name)).toEqual(['constructor'])
})
