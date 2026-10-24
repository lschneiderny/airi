import type { SlotCommand } from '@proj-airi/stage-shared/expression-performance'

import type { SpeechEvent } from '../composables/live2d/expression/slots'
import type { NamedExpressionDefinition } from './expression-store'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolve, useExpressionStore } from './expression-store'

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

  it('set-active false removes only its own base claim, not a slot claim', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    expect(store.activateFromSlot('face', { slot: 'face', expressionId: 'smile', holdSeconds: 1, until: 'hold' })).toBe(true)
    expect(store.settingsSnapshot.groups.find(entry => entry.id === 'smile')?.active).toBe(true)
    store.applySettingsCommand({ type: 'set-active', id: 'smile', active: false })
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual(['smile'])
    expect(store.settingsSnapshot.groups.find(entry => entry.id === 'smile')?.active).toBe(true)
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
    expect(store.activateFromSlot('face', { slot: 'face', expressionId: 'smile', holdSeconds: 1, until: 'hold' })).toBe(true)
    store.applySettingsCommand({ type: 'set-active', id: 'smile', active: true })
    expect(store.manualActive).toEqual(['smile'])
  })

  it('skips a face slot that would displace an active outfit in a user-edited group', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    store.updateEntry('glasses', { group: store.catalog[0].group })
    store.activate('glasses')
    expect(store.activateFromSlot('face', { slot: 'face', expressionId: 'smile', holdSeconds: 1, until: 'hold' })).toBe(false)
    expect(store.manualActive).toEqual(['glasses'])
    expect(store.composer.weightOf('glasses', 1)).toBe(1)
  })

  it('never displaces a saved rest member or a manually active same-kind member', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    store.activate('smile')
    expect(store.activateFromSlot('face', { slot: 'face', expressionId: 'frown', holdSeconds: 1, until: 'hold' })).toBe(false)
    store.saveDefaults()
    expect(store.activateFromSlot('face', { slot: 'face', expressionId: 'frown', holdSeconds: 1, until: 'hold' })).toBe(false)
    expect(store.manualActive).toEqual(['smile'])
    store.deactivate('smile')
    expect(store.activateFromSlot('face', { slot: 'face', expressionId: 'smile', holdSeconds: 1, until: 'hold' })).toBe(true)
    // The user suppressed the rest entry, so only the slot owns it and a same-kind slot may replace it.
    expect(store.activateFromSlot('face', { slot: 'face', expressionId: 'frown', holdSeconds: 1, until: 'hold' })).toBe(true)
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual(['frown'])
  })

  it('replaces only unprotected same-kind slot members', () => {
    const store = useExpressionStore()
    store.registerDefinitions('a', defs)
    expect(store.activateFromSlot('face', { slot: 'face', expressionId: 'smile', holdSeconds: 1, until: 'hold' })).toBe(true)
    expect(store.activateFromSlot('face', { slot: 'face', expressionId: 'frown', holdSeconds: 1, until: 'hold' })).toBe(true)
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual(['frown'])
    expect(store.composer.weightOf('smile', 1)).toBe(0)
    expect(store.activateFromSlot('face', { slot: 'face', expressionId: 'glasses', holdSeconds: 1, until: 'hold' })).toBe(false)
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
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual(['smile'])
    store.onSpeech('clip-end', 'A', 9.8)
    store.onSpeech('turn-end', 'A', 10)
    store.tickLeases(10.04)
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual(['smile'])
    store.tickLeases(10.05 + 0.001)
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual([])
    expect(store.composer.weightOf('smile', 12)).toBe(0)
  })

  it('releases a muted lease after the hold and ignores speech while muted', () => {
    const store = slotStore()
    store.setMuted(true)
    store.applySlots([face('smile', 'A')], 0)
    store.tickLeases(1.1)
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual(['smile'])
    store.tickLeases(1.2)
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual([])
  })

  it('does not release a fresh unstarted lease on an unrelated clip end and is idempotent on turn end', () => {
    const store = slotStore()
    store.applySlots([face('smile', 'A')], 0)
    store.onSpeech('clip-end', 'A', 2)
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual(['smile'])
    store.onSpeech('clip-start', 'A', 2.1)
    store.onSpeech('turn-end', 'A', 3)
    store.onSpeech('turn-end', 'A', 3.1)
    store.onSpeech('turn-end', 'A', 3.2)
    expect(store.leases.face?.turnEndedAt).toBe(3)
    store.tickLeases(3.26)
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual([])
  })

  it('releases immediately on clip-stopped', () => {
    const store = slotStore()
    store.applySlots([face('smile', 'A')], 0)
    store.onSpeech('clip-start', 'A', 0.1)
    store.onSpeech('clip-stopped', 'A', 0.2)
    expect(store.leases.face).toBeNull()
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual([])
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
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual(['frown'])
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
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual([])
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
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual(['frown'])
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
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual([])
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
    expect(Object.values(store.leases).flatMap(lease => lease ? [lease.expressionId] : [])).toEqual([])
  })
})

describe('expression claims', () => {
  let storage: Map<string, string>
  const claimDefs: NamedExpressionDefinition[] = ['hairA', 'hairB', 'blush', 'smirk', 'sparkle', 'prop'].map((id, index) => ({
    id,
    name: id,
    fadeIn: 1,
    fadeOut: 1,
    parameters: [{ id: index < 2 ? 'hair' : id, value: index + 1, blend: 'Add' }],
  }))
  const combo = (id: string, members: { expressionId: string, strength: number }[]) => ({
    id: `combo:${id}`,
    label: id,
    members,
    mappings: [],
    exposedToLlm: true,
  })
  const member = (expressionId: string, strength = 1) => ({ expressionId, strength })
  const document = {
    version: 1,
    overrides: claimDefs.map(def => ({
      id: def.id,
      kind: def.id === 'sparkle' ? 'effect' : def.id === 'prop' ? 'prop' : 'face',
      group: def.id.startsWith('hair') ? 'hair' : null,
    })),
    combos: [
      combo('hair', [member('hairB'), member('blush', 0.5)]),
      combo('face-effect', [member('smirk'), member('sparkle')]),
      combo('low', [member('blush', 0.4)]),
      combo('high', [member('blush', 0.7)]),
      combo('base', [member('hairA'), member('blush')]),
      combo('conflicting', [member('hairA'), member('hairB'), member('sparkle')]),
      combo('face-prop', [member('smirk'), member('prop')]),
    ],
  }
  const command = (expressionId: string | null, slot: SlotCommand['slot'] = 'face', turnId?: string): SlotCommand => ({
    expressionId,
    slot,
    turnId,
    holdSeconds: 2,
    until: turnId ? 'speech' : 'hold',
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    storage = new Map([['expression-catalog:claims', JSON.stringify(document)]])
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

  function fixture() {
    const store = useExpressionStore()
    const setTargets = vi.spyOn(store.composer, 'setTargets')
    store.registerDefinitions('claims', claimDefs)
    return {
      store,
      setTargets,
      targets: () => setTargets.mock.calls.at(-1)![0],
      row: (id: string) => store.settingsSnapshot.groups.find(entry => entry.id === id)!,
    }
  }

  it('resolves purely without changing claims, entries or member order', () => {
    const { store } = fixture()
    const claims = [
      { expressionId: 'hairA', layer: 0, seq: 1 },
      { expressionId: 'combo:hair', layer: 1, seq: 2 },
    ]
    const before = JSON.stringify({ claims, catalog: store.catalog })
    const first = resolve(claims, store.catalog)
    expect(resolve(claims, store.catalog)).toEqual(first)
    expect(JSON.stringify({ claims, catalog: store.catalog })).toBe(before)
    expect(first.targets).toEqual([{ id: 'hairB', weight: 1 }, { id: 'blush', weight: 0.5 }])
    expect(first.masked.get('hairA')).toBe('combo:hair')
  })

  it('reconciles idempotently without restarting a fade', () => {
    const { store, setTargets } = fixture()
    store.activate('combo:low', 0)
    store.reconcile(0.5)
    expect(store.composer.weightOf('blush', 1)).toBeCloseTo(0.4)
    expect(setTargets).toHaveBeenCalledTimes(3)
  })

  it('never sends a combo id to the composer', () => {
    const { store, targets } = fixture()
    store.activate('combo:face-effect', 0)
    expect(targets()).toEqual([{ id: 'smirk', weight: 1 }, { id: 'sparkle', weight: 1 }])
    expect(store.composer.activeIds()).toEqual(['smirk', 'sparkle'])
  })

  it('takes the maximum shared strength and fades from 0.7 back to 0.4 on release', () => {
    const { store, targets, row } = fixture()
    store.activate('combo:low', 0)
    store.activate('combo:high', 1)
    expect(targets()).toEqual([{ id: 'blush', weight: 0.7 }])
    expect(row('blush').via).toEqual(['combo:high', 'combo:low'])
    expect(store.composer.weightOf('blush', 2)).toBeCloseTo(0.7)
    store.deactivate('combo:high', 2)
    expect(targets()).toEqual([{ id: 'blush', weight: 0.4 }])
    expect(store.composer.weightOf('blush', 2.5)).toBeCloseTo(0.55)
    expect(store.composer.weightOf('blush', 3)).toBeCloseTo(0.4)
  })

  it('slot combo restores rest member on release without changing suppression', () => {
    const { store, targets, row } = fixture()
    store.activate('hairA', 0)
    store.saveDefaults()
    store.applySlots([command('combo:hair')], 1)
    expect(row('hairA')).toMatchObject({ active: true, effective: false, overriddenBy: 'hair', isDefault: true })
    expect(store.manualActive).toEqual(['hairA'])
    expect(targets()).toEqual([{ id: 'hairB', weight: 1 }, { id: 'blush', weight: 0.5 }])
    store.releaseSlot('face', 2)
    expect(targets()).toEqual([{ id: 'hairA', weight: 1 }])
    expect(row('hairA')).toMatchObject({ effective: true, overriddenBy: null })
    expect(store.restSuppressed).toEqual([])
  })

  it('manual combo restores rest member when toggled off without changing suppression', () => {
    const { store, targets } = fixture()
    store.toggle('hairA')
    store.saveDefaults()
    store.toggle('combo:hair')
    expect(store.manualActive).toEqual(['hairA', 'combo:hair'])
    store.toggle('combo:hair')
    expect(targets()).toEqual([{ id: 'hairA', weight: 1 }])
    expect(store.restSuppressed).toEqual([])
  })

  it('manual plain toggle removes plain peers and suppresses a rest peer', () => {
    const { store, targets } = fixture()
    store.toggle('hairA')
    store.saveDefaults()
    store.toggle('hairB')
    expect(store.manualActive).toEqual(['hairB'])
    expect(store.restSuppressed).toEqual(['hairA'])
    expect(targets()).toEqual([{ id: 'hairB', weight: 1 }])
  })

  it('manual plain toggle masks only the conflicting member of a base combo', () => {
    const { store, targets, row } = fixture()
    store.toggle('combo:base')
    store.toggle('hairB')
    expect(store.manualActive).toEqual(['combo:base', 'hairB'])
    expect(targets()).toEqual([{ id: 'blush', weight: 1 }, { id: 'hairB', weight: 1 }])
    expect(row('hairA').overriddenBy).toBe('hairB')
    store.toggle('hairB')
    expect(targets()).toEqual([{ id: 'hairA', weight: 1 }, { id: 'blush', weight: 1 }])
  })

  it('refuses a plain slot conflict with any base member and keeps the previous lease', () => {
    const { store } = fixture()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.activate('combo:base', 0)
    store.applySlots([command('smirk')], 0)
    const previous = { ...store.leases.face! }
    store.applySlots([command('hairB')], 1)
    expect(store.leases.face).toEqual(previous)
    // The base member remains protected even while another base combo masks it.
    store.activate('combo:hair', 1)
    store.applySlots([command('hairA')], 1)
    expect(store.leases.face).toEqual(previous)
  })

  it('admits a combo slot conflict and masks instead of deleting the base member', () => {
    const { store, row } = fixture()
    store.activate('hairA', 0)
    store.applySlots([command('combo:hair')], 1)
    expect(store.leases.face?.expressionId).toBe('combo:hair')
    expect(store.manualActive).toEqual(['hairA'])
    expect(row('hairA').overriddenBy).toBe('hair')
  })

  it('gives later claims precedence within a layer and earlier members precedence inside a combo', () => {
    const { store, targets } = fixture()
    store.activate('combo:base', 0)
    store.activate('combo:hair', 0)
    expect(targets()).toEqual([{ id: 'blush', weight: 1 }, { id: 'hairB', weight: 1 }])
    store.activate('combo:base', 0)
    expect(targets()).toEqual([{ id: 'blush', weight: 1 }, { id: 'hairA', weight: 1 }])
    store.resetAll()
    store.activate('combo:conflicting', 0)
    expect(targets()).toEqual([{ id: 'hairA', weight: 1 }, { id: 'sparkle', weight: 1 }])
  })

  it('assigns newer claims a higher claim sequence and composer activationSequence', () => {
    const { store } = fixture()
    store.activate('smirk', 0)
    store.activate('blush', 0)
    expect(store.manualSeq.blush).toBeGreaterThan(store.manualSeq.smirk)
    // Overwrite makes the composer's activation order observable without reading private state.
    store.registerDefinitions('claims', claimDefs.map(def => ({
      ...def,
      parameters: def.id === 'smirk' || def.id === 'blush' ? [{ id: 'x', value: def.id === 'smirk' ? 3 : 7, blend: 'Overwrite' }] : def.parameters,
    })))
    store.activate('smirk', 0)
    store.activate('blush', 0)
    let value = 0
    store.composer.compose(1, () => 0, (_, next) => {
      value = next
    }, () => [-100, 100])
    expect(value).toBe(7)
    store.applySlots([command('sparkle', 'effect')], 1)
    expect(store.leases.effect!.claimSequence).toBeGreaterThan(store.manualSeq.blush)
  })

  it('switching off a masked entry removes its own claim permanently', () => {
    const { store, targets } = fixture()
    store.activate('hairA', 0)
    store.saveDefaults()
    store.applySlots([command('combo:hair')], 0)
    store.applySettingsCommand({ type: 'set-active', id: 'hairA', active: false })
    expect(store.manualActive).toEqual([])
    expect(store.restSuppressed).toEqual(['hairA'])
    store.releaseSlot('face', 1)
    expect(targets()).toEqual([])
  })

  it('toggling a masked own claim switches it off rather than reasserting it', () => {
    const { store, targets } = fixture()
    store.toggle('hairA')
    store.applySlots([command('combo:hair')], 0)
    store.toggle('hairA')
    store.releaseSlot('face', 1)
    expect(store.manualActive).toEqual([])
    expect(targets()).toEqual([])
  })

  it('switching on an entry releases a masking slot combo before reconciliation', () => {
    const { store, row, setTargets } = fixture()
    store.applySlots([command('combo:conflicting'), command('combo:conflicting', 'effect')], 0)
    const calls = setTargets.mock.calls.length
    store.applySettingsCommand({ type: 'set-active', id: 'hairB', active: true })
    expect(store.leases).toEqual({ face: null, effect: null, prop: null })
    expect(row('hairB').effective).toBe(true)
    expect(setTargets.mock.calls.length).toBe(calls + 1)
  })

  it('switching on an entry releases every stacked masking slot combo', () => {
    storage.set('expression-catalog:claims', JSON.stringify({
      ...document,
      combos: [...document.combos, combo('hair-effect', [member('hairB'), member('sparkle')])],
    }))
    const { store, row, targets, setTargets } = fixture()
    store.applySlots([command('combo:hair'), command('combo:hair-effect', 'effect')], 0)
    expect(store.leases.face?.expressionId).toBe('combo:hair')
    expect(store.leases.effect?.expressionId).toBe('combo:hair-effect')
    const calls = setTargets.mock.calls.length

    store.applySettingsCommand({ type: 'set-active', id: 'hairA', active: true })

    expect(row('hairA')).toMatchObject({ active: true, effective: true, overriddenBy: null })
    expect(store.leases).toEqual({ face: null, effect: null, prop: null })
    expect(targets()).toEqual([{ id: 'hairA', weight: 1 }])
    expect(setTargets.mock.calls.length).toBe(calls + 1)
  })

  it('toggling on a combo-only member adds an own claim that survives combo release', () => {
    const { store, targets, row } = fixture()
    store.activate('combo:face-effect', 0)
    expect(row('smirk')).toMatchObject({ active: false, effective: true, via: ['combo:face-effect'] })
    store.toggle('smirk')
    store.toggle('combo:face-effect')
    expect(store.manualActive).toEqual(['smirk'])
    expect(targets()).toEqual([{ id: 'smirk', weight: 1 }])
  })

  it('saves masked base claims in sequence order, excludes slots, and resets to identical targets', () => {
    const { store, targets } = fixture()
    store.activate('hairA', 0)
    store.activate('combo:hair', 0)
    store.applySlots([command('combo:face-effect'), command('combo:face-effect', 'effect')], 0)
    store.saveDefaults()
    expect(store.restSet).toEqual(['hairA', 'combo:hair'])
    store.releaseSlot('face', 0)
    const expected = targets()
    store.resetAll()
    expect(targets()).toEqual(expected)
    expect(store.manualActive).toEqual(['hairA', 'combo:hair'])
  })

  it('creates identical spanning leases and refreshes only the commanded slot', () => {
    const { store, setTargets } = fixture()
    store.applySlots([command('combo:face-effect'), command('combo:face-effect', 'effect')], 0)
    expect(store.leases.face).toEqual(store.leases.effect)
    const oldEffect = { ...store.leases.effect! }
    expect(setTargets).toHaveBeenCalledTimes(2)
    store.applySlots([command('combo:face-effect')], 1)
    expect(store.leases.effect).toEqual(oldEffect)
    expect(store.leases.face!.claimSequence).toBeGreaterThan(oldEffect.claimSequence)
    expect(store.leases.face!.activatedAt).toBe(1)
  })

  it.each(['release', 'replace', 'clear', 'clip-stopped', 'expiry'] as const)('releases every spanned slot atomically on %s', (action) => {
    const { store, setTargets } = fixture()
    store.applySlots([command('combo:face-effect', 'face', 'A'), command('combo:face-effect', 'effect', 'A')], 0)
    const calls = setTargets.mock.calls.length
    if (action === 'release')
      store.releaseSlot('effect', 1)
    else if (action === 'replace')
      store.applySlots([command('blush')], 1)
    else if (action === 'clear')
      store.applySlots([command(null, 'effect')], 1)
    else if (action === 'clip-stopped')
      store.onSpeech('clip-stopped', 'A', 1)
    else
      store.tickLeases(defaultExpressionPerformanceSettings.slots.unstartedExpiry + 2)
    expect(store.leases.effect).toBeNull()
    expect(store.leases.face?.expressionId ?? null).toBe(action === 'replace' ? 'blush' : null)
    expect(setTargets.mock.calls.length).toBe(calls + 1)
  })

  it('neutral clearing face also releases a face+prop combo prop lease', () => {
    const { store } = fixture()
    store.applySlots([command('combo:face-prop'), command('combo:face-prop', 'prop')], 0)
    store.applySlots([command(null), command(null, 'effect')], 1)
    expect(store.leases).toEqual({ face: null, effect: null, prop: null })
  })

  it('loads combo and alias ids from the merged catalog when registering definitions', () => {
    storage.set('expression-rest:claims', JSON.stringify({ version: 1, active: ['combo:hair', 'old-smirk', 'unknown'] }))
    const aliasDefs = [...claimDefs, { ...claimDefs[3], id: 'old-smirk', name: 'old-smirk' }]
    const { store, targets } = fixture()
    store.registerDefinitions('claims', aliasDefs, [{ File: 'smirk', Name: 'Smirk' }])
    expect(store.restSet).toEqual(['combo:hair', 'smirk'])
    expect(targets()).toEqual([{ id: 'hairB', weight: 1 }, { id: 'blush', weight: 0.5 }, { id: 'smirk', weight: 1 }])
  })

  it('prints the manual QA trace for defaults, shared strength and spanning release', () => {
    const { store, targets, row } = fixture()
    const trace: { step: string, targets: { id: string, weight: number }[], overriddenBy: string | null, leases: typeof store.leases }[] = []
    const record = (step: string) => trace.push({ step, targets: structuredClone(targets()), overriddenBy: row('hairA').overriddenBy, leases: JSON.parse(JSON.stringify(store.leases)) })
    store.activate('hairA', 0)
    store.saveDefaults()
    record('saved hairA')
    store.applySlots([command('combo:hair')], 1)
    record('combo masks hairA')
    expect(row('hairA').overriddenBy).toBe('hair')
    store.releaseSlot('face', 2)
    record('hairA restored')
    expect(targets()).toEqual([{ id: 'hairA', weight: 1 }])
    store.activate('combo:low', 3)
    record('shared 0.4')
    store.activate('combo:high', 4)
    record('shared max 0.7')
    expect(targets().find(target => target.id === 'blush')?.weight).toBe(0.7)
    store.deactivate('combo:high', 5)
    record('shared returns 0.4')
    expect(targets().find(target => target.id === 'blush')?.weight).toBe(0.4)
    store.applySlots([command('combo:face-effect'), command('combo:face-effect', 'effect')], 6)
    record('face and effect identical')
    expect(store.leases.face).toEqual(store.leases.effect)
    store.applySlots([command(null)], 7)
    record('clear face releases both')
    expect(store.leases.face).toBeNull()
    expect(store.leases.effect).toBeNull()
    console.info(`TASK_8_TRACE=${JSON.stringify(trace)}`)
  })
})
