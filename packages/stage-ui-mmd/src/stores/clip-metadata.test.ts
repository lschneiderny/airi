// @vitest-environment jsdom

import type { DerivedClipMeta } from '@proj-airi/motion-driver-humanoid/clip-meta'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'

import { useMMDClipMetadata } from './clip-metadata'
import { useMMDPerformanceSettings } from './performance-settings'

const contexts: ReturnType<typeof createPinia>[] = []
function context() {
  const pinia = createPinia()
  contexts.push(pinia)
  return { metadata: useMMDClipMetadata(pinia), settings: useMMDPerformanceSettings(pinia) }
}
function clip(name: string): DerivedClipMeta & { name: string } {
  return { name, label: name, kind: 'gesture', layer: 'upper', loop: false, durationMs: 2000, notes: [] }
}
afterEach(() => {
  contexts.splice(0).forEach(disposePinia)
  localStorage.clear()
  vi.restoreAllMocks()
})

it('clears a replaced model immediately and rejects its late completion', () => {
  const { metadata } = context()
  const a = metadata.beginLoad('model-a')
  expect(metadata.publish('model-a', a, clip('wave'))).toBe(true)
  const b = metadata.beginLoad('model-b')
  expect(metadata.snapshot.clips).toEqual({})
  expect(metadata.clipFor('model-a', 'wave')).toBeUndefined()
  expect(metadata.publish('model-a', a, clip('late'))).toBe(false)
  expect(metadata.publish('model-b', b, clip('bow'))).toBe(true)
  metadata.invalidate('model-a', a)
  expect(Object.keys(metadata.snapshot.clips)).toEqual(['bow'])
})

it('invalidates a previous library load of the same model and copies the published values', () => {
  const { metadata } = context()
  const first = metadata.beginLoad('model-a')
  const second = metadata.beginLoad('model-a')
  expect(metadata.publish('model-a', first, clip('old'))).toBe(false)
  const value = { ...clip('wave') }
  metadata.publish('model-a', second, value)
  value.label = 'changed-outside'
  expect(metadata.snapshot.clips.wave.label).toBe('wave')
  metadata.invalidate('model-a', second)
  expect(metadata.publish('model-a', second, clip('late'))).toBe(false)
  expect(metadata.snapshot.modelId).toBeNull()
})

it('starts empty after reload and never saves a catalog or defaults', async () => {
  localStorage.setItem('settings/mmd/available-clip-meta', JSON.stringify({ stale: clip('stale') }))
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  const { metadata } = context()
  expect(metadata.snapshot.clips).toEqual({})
  const epoch = metadata.beginLoad('model-a')
  metadata.publish('model-a', epoch, clip('wave'))
  expect(context().metadata.snapshot.clips).toEqual({})
  await metadata.reset()
  expect(writes).not.toHaveBeenCalled()
})

it('removes all old global and scoped catalogs without importing any of them', async () => {
  localStorage.setItem('settings/mmd/available-clip-meta', 'old')
  localStorage.setItem('settings/models/model-a/mmd/available-clip-meta', 'old')
  localStorage.setItem('settings/models/model-b/mmd/available-clip-meta', 'old')
  localStorage.setItem('settings/models/model-a/mmd/physics-enabled', 'false')
  const { metadata } = context()
  await metadata.initialize()
  expect(metadata.snapshot.clips).toEqual({})
  expect(Object.keys(localStorage)).toEqual(['settings/models/model-a/mmd/physics-enabled'])
})

it('invalidates pending loads when their model or the settings are reset', async () => {
  const { metadata, settings } = context()
  const epoch = metadata.beginLoad('model-a')
  metadata.publish('model-a', epoch, clip('wave'))
  await settings.removeModel('model-b')
  expect(metadata.snapshot.modelId).toBe('model-a')
  // Even a model with no explicit durable settings owns a runtime load.
  await settings.removeModel('model-a')
  expect(metadata.snapshot.modelId).toBeNull()
  expect(metadata.publish('model-a', epoch, clip('late'))).toBe(false)
  const next = metadata.beginLoad('model-b')
  await settings.reset()
  expect(metadata.publish('model-b', next, clip('late'))).toBe(false)
  expect(metadata.snapshot.clips).toEqual({})
})

it('invalidates a removed clip before a later load can resurrect it and keeps other completed clips', async () => {
  const { metadata } = context()
  const epoch = metadata.beginLoad('model-a')
  metadata.publish('model-a', epoch, clip('wave'))
  metadata.publish('model-a', epoch, clip('bow'))
  await metadata.removeClip('wave')
  expect(metadata.publish('model-a', epoch, clip('wave'))).toBe(false)
  expect(Object.keys(metadata.snapshot.clips)).toEqual(['bow'])
})
