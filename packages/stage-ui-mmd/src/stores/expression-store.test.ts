import type { ExpressionMorphSink } from './expression-store'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { chisaMorphs, ellenLikeMorphs, morphInfos } from '../utils/expression-catalog/pmx-morph-fixtures'
import { useMMDExpressionStore } from './expression-store'

type SinkCall = ['set', string, string, number] | ['clear', string, string]

function fakeRuntime() {
  const calls: SinkCall[] = []
  const sink: ExpressionMorphSink = {
    setChannel: (layer, morphName, weight) => calls.push(['set', layer, morphName, weight]),
    clearChannel: (layer, morphName) => calls.push(['clear', layer, morphName]),
  }
  return { sink, calls }
}

/** Rounds weights so cosine easing at half time compares exactly. */
function rounded(calls: SinkCall[]) {
  return calls.map(call => call[0] === 'set' ? ['set', call[1], call[2], Math.round(call[3] * 1000) / 1000] : call)
}

describe('mmd expression store', () => {
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

  it('fades a face lease into the expression layer, holds it, then fades out and clears the channel', () => {
    const { sink, calls } = fakeRuntime()
    const store = useMMDExpressionStore()
    store.registerMorphs('display-model-ellen', morphInfos(ellenLikeMorphs), sink, 0)
    store.applySlots([{ slot: 'face', expressionId: 'mmd:3:笑い', holdSeconds: 2, until: 'hold' }], 0)

    const trace: [number, SinkCall[]][] = []
    for (const now of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
      calls.length = 0
      store.update(now)
      trace.push([now, rounded(calls) as SinkCall[]])
    }

    expect(trace).toEqual([
      [0, []],
      [0.5, [['set', 'expression', '笑い', 0.5]]],
      [1, [['set', 'expression', '笑い', 1]]],
      [1.5, []],
      // The hold ends at 2 s; the release starts from full weight.
      [2, []],
      [2.5, [['set', 'expression', '笑い', 0.5]]],
      [3, [['clear', 'expression', '笑い']]],
      [3.5, []],
    ])
    expect(store.leases.face).toBeNull()
  })

  it('applies a standard-Chisa effect lease and a combo through setChannel on a fake runtime', () => {
    const { sink, calls } = fakeRuntime()
    const store = useMMDExpressionStore()
    store.registerMorphs('display-model-chisa', morphInfos(chisaMorphs), sink, 0)
    store.setSlotSettings({ speechGrace: 0.25, unstartedExpiry: 10, holdCap: 15, defaultFadeSeconds: 0.5 })
    expect(store.catalog).toHaveLength(176)

    store.applySlots([{ slot: 'effect', expressionId: 'mmd:112:eye off', holdSeconds: 5, until: 'hold' }], 0)
    store.update(0.5)
    expect(calls).toEqual([['set', 'expression', 'eye off', 1]])

    calls.length = 0
    const comboId = store.createCombo({ label: 'beam', members: [{ expressionId: 'mmd:25:笑い', strength: 0.6 }, { expressionId: 'mmd:6:にこり', strength: 1 }] })
    expect(comboId).toMatch(/^combo:/)
    store.applySlots([{ slot: 'face', expressionId: comboId!, holdSeconds: 5, until: 'hold' }], 1)
    store.update(1.5)
    expect(calls).toEqual([
      ['set', 'expression', '笑い', 0.6],
      ['set', 'expression', 'にこり', 1],
    ])
    expect(store.settingsSnapshot.activeIds).toEqual(['mmd:112:eye off', comboId])
  })

  it('ignores an unknown expression id without throwing and logs it once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sink, calls } = fakeRuntime()
    const store = useMMDExpressionStore()
    store.registerMorphs('display-model-ellen', morphInfos(ellenLikeMorphs), sink, 0)

    expect(() => {
      store.applySlots([{ slot: 'face', expressionId: 'mmd:999:missing', holdSeconds: 2, until: 'hold' }], 0)
      store.applySlots([{ slot: 'face', expressionId: 'mmd:999:missing', holdSeconds: 2, until: 'hold' }], 0.1)
      store.applySettingsCommand({ type: 'set-active', id: 'mmd:999:missing', active: true })
      store.update(1)
    }).not.toThrow()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toBe('mmd:999:missing')
    expect(store.leases).toEqual({ face: null, effect: null, prop: null })
    expect(store.manualActive).toEqual([])
    expect(calls).toEqual([])
  })

  it('round-trips curation and the rest set per model id under the Live2D storage keys', () => {
    const morphs = morphInfos(ellenLikeMorphs)
    const first = useMMDExpressionStore()
    first.registerMorphs('display-model-a', morphs)
    first.applySettingsCommand({ type: 'update-entry', id: 'mmd:3:笑い', patch: { kind: 'effect', exposedToLlm: false } })
    first.applySettingsCommand({ type: 'set-active', id: 'mmd:18:にこり', active: true })
    first.applySettingsCommand({ type: 'save-defaults' })

    expect([...storage.keys()].sort()).toEqual(['expression-catalog:display-model-a', 'expression-rest:display-model-a'])
    expect(JSON.parse(storage.get('expression-catalog:display-model-a')!)).toEqual({ version: 1, overrides: [{ id: 'mmd:3:笑い', kind: 'effect', exposedToLlm: false }] })
    expect(JSON.parse(storage.get('expression-rest:display-model-a')!)).toEqual({ version: 1, active: ['mmd:18:にこり'] })

    setActivePinia(createPinia())
    const second = useMMDExpressionStore()
    second.registerMorphs('display-model-b', morphs)
    expect(second.catalog.find(entry => entry.id === 'mmd:3:笑い')).toMatchObject({ kind: 'face', exposedToLlm: true })
    expect(second.settingsSnapshot.restIds).toEqual([])

    second.registerMorphs('display-model-a', morphs)
    expect(second.catalog.find(entry => entry.id === 'mmd:3:笑い')).toMatchObject({ kind: 'effect', exposedToLlm: false })
    expect(second.llmEligibleEntries.some(entry => entry.id === 'mmd:3:笑い')).toBe(false)
    expect(second.settingsSnapshot).toMatchObject({ modelId: 'display-model-a', activeIds: ['mmd:18:にこり'], restIds: ['mmd:18:にこり'] })
  })

  it('discards corrupt stored documents through the schema and keeps working', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.set('expression-catalog:display-model-a', '{not json')
    storage.set('expression-rest:display-model-a', JSON.stringify({ version: 2, active: ['mmd:3:笑い'] }))
    const store = useMMDExpressionStore()

    expect(() => store.registerMorphs('display-model-a', morphInfos(ellenLikeMorphs))).not.toThrow()
    expect(store.curated).toEqual({ version: 1, overrides: [] })
    expect(store.restSet).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)

    storage.set('expression-catalog:display-model-b', JSON.stringify({ version: 1, overrides: [{ id: 'mmd:3:笑い', kind: 'not-a-kind' }] }))
    store.registerMorphs('display-model-b', morphInfos(ellenLikeMorphs))
    expect(store.catalog.find(entry => entry.id === 'mmd:3:笑い')?.kind).toBe('face')

    store.applySettingsCommand({ type: 'update-entry', id: 'mmd:3:笑い', patch: { group: 'smiles' } })
    store.applySettingsCommand({ type: 'update-entry', id: 'mmd:18:にこり', patch: { group: 'smiles' } })
    expect(JSON.parse(storage.get('expression-catalog:display-model-b')!).overrides).toHaveLength(2)
    expect(store.settingsSnapshot.groups).toEqual([{ id: 'smiles', memberIds: ['mmd:3:笑い', 'mmd:18:にこり'] }])
  })
})
