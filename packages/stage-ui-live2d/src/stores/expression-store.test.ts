import type { SlotCommand } from '@proj-airi/stage-shared/expression-performance'

import type { SpeechEvent } from '../composables/live2d/expression/slots'
import type { NamedExpressionDefinition } from './expression-store'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useExpressionStore } from './expression-store'

const defs: NamedExpressionDefinition[] = ['smile', 'frown', 'glasses'].map((id, index) => ({
  id,
  name: id,
  fadeIn: 0,
  fadeOut: 1,
  parameters: [{ id: 'ParamMouthForm', value: index + 1, blend: 'Add' }],
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

  it('loads curated keepSeparate before deriving and rederives using retained model metadata', () => {
    const store = useExpressionStore()
    const duplicates: NamedExpressionDefinition[] = ['a', 'b'].map(id => ({
      id,
      name: id,
      parameters: [{ id: 'opaque', value: 1, blend: 'Add' }],
    }))
    storage.set('expression-catalog:a', JSON.stringify({ version: 1, overrides: [{ id: 'b', keepSeparate: true }] }))
    const refs = [{ File: 'a', Name: 'Puff Cheeks' }]
    const vtube = { Hotkeys: [{ Action: 'ToggleExpression', File: 'b', Name: '鼓脸' }] }
    const displayInfo = { Parameters: [{ Id: 'opaque', Name: '鼓脸' }] }
    store.registerDefinitions('a', duplicates, refs, vtube, displayInfo)
    expect(store.derived.every(entry => entry.duplicateOf === undefined)).toBe(true)
    expect(store.derived.map(entry => entry.area)).toEqual(['cheeks', 'cheeks'])
    store.updateEntry('b', { keepSeparate: false })
    store.rederive()
    expect(store.derived[0]).toMatchObject({ label: 'Puff Cheeks', labelSource: 'model', aliases: ['b'], area: 'cheeks' })
    expect(store.derived[1]).toMatchObject({ label: '鼓脸', labelSource: 'vtube', duplicateOf: 'a' })
    store.updateEntry('b', { keepSeparate: true })
    store.rederive()
    expect(store.derived.every(entry => entry.duplicateOf === undefined && entry.aliases === undefined)).toBe(true)
    expect(store.curated.overrides).toEqual([{ id: 'b', keepSeparate: true }])
    store.dispose()
    store.rederive()
    expect(store.derived).toEqual([])
  })

  it('fades expressions without a valid file fade over the slot default fade', () => {
    const store = useExpressionStore()
    store.setSlotSettings({ ...defaultExpressionPerformanceSettings.slots, defaultFadeSeconds: 2 })
    store.registerDefinitions('a', [{ id: 'plain', name: 'plain', fadeOut: Number.NaN, parameters: [{ id: 'switch', value: 1, blend: 'Add' }] }])
    store.activate('plain')
    expect(store.composer.weightOf('plain', 1)).toBeCloseTo(0.5)
    store.deactivate('plain', 2)
    expect(store.composer.weightOf('plain', 3)).toBeCloseTo(0.5)
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
    expect(store.autoEligibleEntries.map(entry => entry.id)).toEqual(['smile', 'frown'])
    // Derived exposure follows the kind: both faces are exposed, the outfit is not.
    expect(store.llmEligibleEntries.map(entry => entry.id)).toEqual(['smile', 'frown'])
    store.resetEntry('smile')
    expect(store.catalog[0].label).toBe('smile')
    expect(store.autoEligibleEntries.map(entry => entry.id)).toEqual(['smile', 'frown'])
    expect(store.llmEligibleEntries.map(entry => entry.id)).toEqual(['smile', 'frown'])
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

  it('set-active true on a group member deactivates its siblings', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    store.applySettingsCommand({ type: 'set-active', id: 'smile', active: true })
    store.applySettingsCommand({ type: 'set-active', id: 'frown', active: true })
    expect(store.manualActive).toEqual(['frown'])
    expect(store.composer.weightOf('smile', 1)).toBe(0)
  })

  it('set-active false on a slot-owned entry leaves it inactive', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    expect(store.activateFromSlot('smile', 'face')).toBe(true)
    expect(store.settingsSnapshot.groups.find(entry => entry.id === 'smile')?.active).toBe(true)
    store.applySettingsCommand({ type: 'set-active', id: 'smile', active: false })
    expect(store.slotActive).toEqual([])
    expect(store.settingsSnapshot.groups.find(entry => entry.id === 'smile')?.active).toBe(false)
  })

  it('set-active false on a rest-set member suppresses it until resetAll', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    store.activate('smile')
    store.saveDefaults()
    store.applySettingsCommand({ type: 'set-active', id: 'smile', active: false })
    expect(store.restSuppressed).toEqual(['smile'])
    expect(store.settingsSnapshot.groups.find(entry => entry.id === 'smile')?.active).toBe(false)
    store.resetAll()
    expect(store.restSuppressed).toEqual([])
    expect(store.settingsSnapshot.groups.find(entry => entry.id === 'smile')?.active).toBe(true)
  })

  it('set-active true on a slot-owned entry records manual intent', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    expect(store.activateFromSlot('smile', 'face')).toBe(true)
    store.applySettingsCommand({ type: 'set-active', id: 'smile', active: true })
    expect(store.manualActive).toEqual(['smile'])
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
    // The user suppressed the rest entry, so only the slot owns it and a same-kind slot may replace it.
    expect(store.activateFromSlot('frown', 'face')).toBe(true)
    expect(store.slotActive).toEqual(['frown'])
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

describe('speech-bound expression slots', () => {
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

  function slotStore() {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    store.updateEntry('glasses', { kind: 'effect' })
    return store
  }

  const face = (expressionId: string | null, turnId?: string, until: 'speech' | 'hold' = 'speech', holdSeconds = 1.2) =>
    ({ slot: 'face' as const, expressionId, holdSeconds, until, turnId })

  it('keeps a speech face through the turn and releases it after turn end plus grace', () => {
    const store = slotStore()
    store.applySlots([face('smile', 'A')], 0)
    store.onSpeech('clip-start', 'A', 0.1)
    store.tickLeases(8)
    expect(store.slotActive).toEqual(['smile'])
    store.onSpeech('clip-end', 'A', 9.8)
    store.onSpeech('turn-end', 'A', 10)
    store.tickLeases(10.04)
    expect(store.slotActive).toEqual(['smile'])
    store.tickLeases(10.05 + 0.001)
    expect(store.slotActive).toEqual([])
    expect(store.composer.weightOf('smile', 12)).toBe(0)
  })

  it('releases a muted lease after the hold and ignores speech while muted', () => {
    const store = slotStore()
    store.setMuted(true)
    store.applySlots([face('smile', 'A')], 0)
    store.tickLeases(1.1)
    expect(store.slotActive).toEqual(['smile'])
    store.tickLeases(1.2)
    expect(store.slotActive).toEqual([])
  })

  it('does not release a fresh unstarted lease on an unrelated clip end and is idempotent on turn end', () => {
    const store = slotStore()
    store.applySlots([face('smile', 'A')], 0)
    store.onSpeech('clip-end', 'A', 2)
    expect(store.slotActive).toEqual(['smile'])
    store.onSpeech('clip-start', 'A', 2.1)
    store.onSpeech('turn-end', 'A', 3)
    store.onSpeech('turn-end', 'A', 3.1)
    store.onSpeech('turn-end', 'A', 3.2)
    expect(store.leases.face?.turnEndedAt).toBe(3)
    store.tickLeases(3.26)
    expect(store.slotActive).toEqual([])
  })

  it('releases immediately on clip-stopped', () => {
    const store = slotStore()
    store.applySlots([face('smile', 'A')], 0)
    store.onSpeech('clip-start', 'A', 0.1)
    store.onSpeech('clip-stopped', 'A', 0.2)
    expect(store.leases.face).toBeNull()
    expect(store.slotActive).toEqual([])
  })

  it('isolates two interleaved turns in both directions', () => {
    const store = slotStore()
    const effect = { slot: 'effect' as const, expressionId: 'glasses', holdSeconds: 1.2, until: 'speech' as const, turnId: 'B' }
    store.applySlots([face('smile', 'A'), effect], 0)
    store.onSpeech('clip-start', 'A', 0.1)
    store.onSpeech('clip-start', 'B', 0.2)
    store.onSpeech('turn-end', 'A', 2)
    store.onSpeech('clip-stopped', 'A', 2.1)
    store.tickLeases(5)
    expect(store.leases.face).toBeNull()
    expect(store.leases.effect?.expressionId).toBe('glasses')
    store.applySlots([face('smile', 'A')], 5)
    store.onSpeech('clip-start', 'A', 5.1)
    store.onSpeech('turn-end', 'B', 6)
    store.onSpeech('clip-stopped', 'B', 6.1)
    expect(store.leases.effect).toBeNull()
    expect(store.leases.face?.expressionId).toBe('smile')
  })

  it('leaves leases without a turn id to the hold rule', () => {
    const store = slotStore()
    store.applySlots([face('smile')], 0)
    store.onSpeech('clip-stopped', 'A', 0.1)
    expect(store.leases.face).not.toBeNull()
    store.tickLeases(1.2)
    expect(store.leases.face).toBeNull()
  })

  it('keeps a rest-set expression active after its slot lease releases', () => {
    const store = slotStore()
    store.activate('smile')
    store.saveDefaults()
    store.applySlots([face('smile', undefined, 'hold')], 0)
    store.tickLeases(2)
    expect(store.leases.face).toBeNull()
    expect(store.manualActive).toEqual(['smile'])
    expect(store.composer.weightOf('smile', 5)).toBe(1)
  })

  it('keeps a manually toggled expression active after release', () => {
    const store = slotStore()
    store.applySlots([face('smile', undefined, 'hold')], 0)
    store.activate('smile')
    store.tickLeases(2)
    expect(store.composer.weightOf('smile', 5)).toBe(1)
  })

  const snapshotActive = (store: ReturnType<typeof slotStore>, id: string) =>
    store.settingsSnapshot.groups.find(entry => entry.id === id)?.active

  it('deactivates a suppressed rest member on release so the render and the snapshot agree', () => {
    const store = slotStore()
    store.activate('smile')
    store.saveDefaults()
    store.toggle('smile')
    store.applySlots([face('smile', undefined, 'hold')], 0)
    store.tickLeases(2)
    expect(store.leases.face).toBeNull()
    expect(store.composer.weightOf('smile', 3)).toBe(0)
    expect(snapshotActive(store, 'smile')).toBe(false)
    store.applySlots([face('frown', undefined, 'hold')], 2)
    expect(store.slotActive).toEqual(['frown'])
    expect(store.composer.weightOf('frown', 3)).toBe(1)
    expect(store.composer.weightOf('smile', 3)).toBe(0)
    expect(snapshotActive(store, 'frown')).toBe(true)
    expect(snapshotActive(store, 'smile')).toBe(false)
  })

  it('keeps an unsuppressed rest member active after release and protects its group', () => {
    const store = slotStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.activate('smile')
    store.saveDefaults()
    store.applySlots([face('smile', undefined, 'hold')], 0)
    store.tickLeases(2)
    expect(store.composer.weightOf('smile', 3)).toBe(1)
    expect(snapshotActive(store, 'smile')).toBe(true)
    store.applySlots([face('frown', undefined, 'hold')], 2)
    expect(store.leases.face).toBeNull()
    expect(store.slotActive).toEqual([])
    expect(store.composer.weightOf('frown', 3)).toBe(0)
    expect(warn).toHaveBeenCalledWith('[expression-store] Slot activation skipped for protected group:', 'frown')
  })

  it('clears the rest suppression on reset and on save defaults', () => {
    const store = slotStore()
    store.activate('smile')
    store.saveDefaults()
    store.toggle('smile')
    expect(store.restSuppressed).toEqual(['smile'])
    store.resetAll()
    expect(store.restSuppressed).toEqual([])
    expect(snapshotActive(store, 'smile')).toBe(true)
    store.toggle('smile')
    expect(store.restSuppressed).toEqual(['smile'])
    store.saveDefaults()
    expect(store.restSuppressed).toEqual([])
    expect(store.restSet).toEqual([])
  })

  it('fades the old member when a lease replaces another in a pick-one group', () => {
    const store = slotStore()
    store.applySlots([face('smile', 'A')], 0)
    store.applySlots([face('frown', 'A')], 2)
    expect(store.slotActive).toEqual(['frown'])
    expect(store.leases.face?.expressionId).toBe('frown')
    expect(store.composer.weightOf('smile', 2.5)).toBeCloseTo(0.5)
    expect(store.composer.weightOf('smile', 3)).toBe(0)
  })

  it('releases on a null command and drops a replacement that would displace a protected member', () => {
    const store = slotStore()
    store.applySlots([face('smile', 'A')], 0)
    store.applySlots([face(null)], 1)
    expect(store.leases.face).toBeNull()
    store.activate('frown')
    store.applySlots([face('smile', 'A')], 2)
    expect(store.leases.face).toBeNull()
    expect(store.manualActive).toEqual(['frown'])
  })

  it('drops malformed input without touching state', () => {
    const store = slotStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.applySlots([face('smile', 'A')], Number.NaN)
    store.applySlots([face('missing', 'A'), face('smile', 'A', 'speech', Number.NaN), face('glasses', 'A')], 0)
    const bogusCommand: unknown = { slot: 'bogus', expressionId: 'smile', holdSeconds: 1, until: 'hold' }
    store.applySlots([bogusCommand as SlotCommand], 0)
    expect(store.leases).toEqual({ face: null, effect: null, prop: null })
    expect(store.slotActive).toEqual([])
    store.applySlots([face('smile', 'A')], 0)
    store.tickLeases(Number.NaN)
    store.onSpeech('turn-end', 'A', Number.NaN)
    const bogusEvent: unknown = 'bogus'
    store.onSpeech(bogusEvent as SpeechEvent, 'A', 1)
    expect(store.leases.face?.turnEndedAt).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('discards leases on model switch, reset and dispose', () => {
    const store = slotStore()
    store.applySlots([face('smile', 'A')], 0)
    store.registerDefinitions('b', defs)
    expect(store.leases.face).toBeNull()
    store.applySlots([face('smile', 'A')], 0)
    store.dispose()
    expect(store.leases).toEqual({ face: null, effect: null, prop: null })
    store.onSpeech('turn-end', 'A', 1)
    store.tickLeases(2)
    expect(store.slotActive).toEqual([])
  })
})
