import type { NamedExpressionDefinition } from './expression-store'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useExpressionStore } from './expression-store'

const defs: NamedExpressionDefinition[] = ['smile', 'frown', 'glasses'].map(id => ({
  id,
  name: id,
  fadeIn: 0,
  fadeOut: 1,
  parameters: [{ id: 'switch', value: 1, blend: 'Add' }],
}))

describe('curated expression catalog', () => {
  let storage: Map<string, string>
  beforeEach(() => {
    setActivePinia(createPinia())
    storage = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.spyOn(performance, 'now').mockReturnValue(0)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('persists and reloads per model without leaking into a second model', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    store.updateEntry('smile', { label: 'Joy', confirmed: true, exposedToLlm: true })
    expect(JSON.parse(storage.get('expression-catalog:a')!).overrides[0].label).toBe('Joy')
    store.registerDefinitions('b', defs)
    expect(store.catalog[0].label).toBe('smile')
    store.updateEntry('smile', { label: 'Other' })
    store.registerDefinitions('a', defs)
    expect(store.catalog[0].label).toBe('Joy')
    expect(store.autoEligibleEntries.map(entry => entry.id)).toEqual(['smile'])
    expect(store.llmEligibleEntries.map(entry => entry.id)).toEqual(['smile'])
    store.resetEntry('smile')
    expect(store.catalog[0].label).toBe('smile')
    store.confirmAllSuggested()
    expect(store.catalog.every(entry => entry.confirmed)).toBe(true)
    expect(store.autoEligibleEntries.map(entry => entry.id)).toEqual(['smile', 'frown'])
    expect(store.llmEligibleEntries).toEqual([])
  })

  it('fades other group members on manual activation and rest reset', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    store.activate('smile')
    store.saveDefaults()
    store.activate('frown')
    expect(store.manualActive).toEqual(['frown'])
    expect(store.composer.weightOf('smile', 0.5)).toBeCloseTo(0.5)
    expect(store.composer.weightOf('smile', 1)).toBe(0)
    store.resetAll()
    expect(store.manualActive).toEqual(['smile'])
    expect(store.composer.weightOf('frown', 1)).toBe(0)
  })

  it('skips a face slot that would displace an active outfit in a user-edited group', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    store.updateEntry('glasses', { group: store.catalog[0].group })
    store.activate('glasses')
    expect(store.activateFromSlot('smile', 'face')).toBe(false)
    expect(store.manualActive).toEqual(['glasses'])
    expect(store.composer.weightOf('glasses', 1)).toBe(1)
  })

  it('never displaces a saved rest member or a manually active same-kind member', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    store.activate('smile')
    expect(store.activateFromSlot('frown', 'face')).toBe(false)
    store.saveDefaults()
    expect(store.activateFromSlot('frown', 'face')).toBe(false)
    expect(store.manualActive).toEqual(['smile'])
    store.deactivate('smile')
    expect(store.activateFromSlot('smile', 'face')).toBe(true)
    expect(store.activateFromSlot('frown', 'face')).toBe(false)
    expect(store.slotActive).toEqual(['smile'])
  })

  it('replaces only unprotected same-kind slot members', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    expect(store.activateFromSlot('smile', 'face')).toBe(true)
    expect(store.activateFromSlot('frown', 'face')).toBe(true)
    expect(store.slotActive).toEqual(['frown'])
    expect(store.composer.weightOf('smile', 1)).toBe(0)
    expect(store.activateFromSlot('glasses', 'outfit')).toBe(false)
  })

  it.each(['{broken', '{"version":1,"overrides":[{"id":"smile","kind":"invalid"}]}'])('discards invalid persisted data: %s', (raw) => {
    storage.set('expression-catalog:a', raw)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    expect(store.curated.overrides).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('ignores unknown persisted ids and rejects unknown commands and malformed patches atomically', () => {
    storage.set('expression-catalog:a', JSON.stringify({ version: 1, overrides: [{ id: 'missing', label: 'Unknown' }] }))
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    expect(store.catalog.map(entry => entry.label)).toEqual(['smile', 'frown', 'glasses'])
    expect(() => store.updateEntry('missing', { label: 'No' })).toThrow('Unknown expression')
    const patch: unknown = { kind: 'invalid' }
    expect(() => store.updateEntry('smile', patch as Parameters<typeof store.updateEntry>[1])).toThrow()
    expect(store.catalog[0].label).toBe('smile')
  })
})
