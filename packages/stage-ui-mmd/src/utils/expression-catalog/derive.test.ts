import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import { isLlmEligible } from '@proj-airi/stage-shared/expression-performance'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deriveMMDCatalog } from './derive'
import { chisaMorphs, ellenLikeMorphs, morphInfos } from './pmx-morph-fixtures'

function byLabel(catalog: CatalogEntry[], label: string): CatalogEntry {
  const entry = catalog.find(candidate => candidate.label === label)
  expect(entry, label).toBeDefined()
  return entry!
}

function kindCounts(catalog: CatalogEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of catalog)
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1
  return counts
}

describe('deriveMMDCatalog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('derives an Ellen-like catalog with system vowels, a happy 笑い face and effect material morphs', () => {
    const catalog = deriveMMDCatalog(morphInfos(ellenLikeMorphs))

    for (const vowel of ['あ', 'い', 'う', 'え', 'お'])
      expect(byLabel(catalog, vowel)).toMatchObject({ kind: 'system', area: 'hidden', exposedToLlm: false, mappings: [] })
    for (const blink of ['まばたき', 'ウィンク', 'ウィンク右', 'ウィンク２', 'ウィンク２右'])
      expect(byLabel(catalog, blink).kind).toBe('system')

    expect(byLabel(catalog, '笑い')).toEqual({
      id: 'mmd:3:笑い',
      label: '笑い',
      labelSource: 'model',
      kind: 'face',
      area: 'eyes',
      group: null,
      confirmed: false,
      exposedToLlm: true,
      mappings: [{ emotion: 'happy', weight: 0.5, minBand: 'clear' }],
      fileName: '笑い',
      parameterIds: ['笑い'],
    })
    expect(byLabel(catalog, 'にやり')).toMatchObject({ kind: 'face', area: 'mouth', mappings: [{ emotion: 'happy' }] })

    for (const material of ['eye off', '口紅 off', 'heng al'])
      expect(byLabel(catalog, material)).toMatchObject({ kind: 'effect', area: 'effects', exposedToLlm: true })
    // Negated names such as "off" never map to an emotion.
    expect(byLabel(catalog, 'eye off').mappings).toEqual([])
    // A hidden-panel UV morph is an effect the LLM cannot pick until the user exposes it.
    expect(byLabel(catalog, 'han')).toMatchObject({ kind: 'effect', area: 'hidden', exposedToLlm: false })

    expect(kindCounts(catalog)).toEqual({ system: 10, face: 49, effect: 4 })
  })

  it('derives one entry per standard-Chisa morph with the expected kind counts', () => {
    const morphs = morphInfos(chisaMorphs)
    const catalog = deriveMMDCatalog(morphs)

    expect(catalog.length).toBeGreaterThan(100)
    expect(catalog).toHaveLength(176)
    expect(catalog.map(entry => entry.id)).toEqual(morphs.map(morph => `mmd:${morph.index}:${morph.name}`))
    // 13 UV + 5 material morphs are effects; vowels and the blink/wink family (including まばたきA) are system.
    expect(kindCounts(catalog)).toEqual({ face: 146, system: 12, effect: 18 })
    expect(catalog.filter(entry => entry.kind === 'system').map(entry => entry.label)).toEqual(['まばたき', 'ウィンク右', 'ウィンク', 'ウィンク２', 'ｳｨﾝｸ２右', 'ｳｨﾝｸ２右2', 'あ', 'い', 'う', 'え', 'お', 'まばたきA'])
    expect(catalog.filter(isLlmEligible)).toHaveLength(148)
    expect(byLabel(catalog, '(。-ω-)zzz').mappings.map(mapping => mapping.emotion)).toEqual(['sleepy'])
    expect(byLabel(catalog, '[・_・?]').mappings.map(mapping => mapping.emotion)).toEqual(['question'])
    expect(byLabel(catalog, '真面目').mappings).toEqual([])
  })

  it('keeps one entry per morph for empty and whitespace names, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const catalog = deriveMMDCatalog([
      { index: 0, name: '', category: 4, type: 1 },
      { index: 1, name: '  ', category: 2, type: 8 },
      { index: 2, name: 'smile', category: 2, type: 1 },
    ])

    expect(catalog.map(({ id, label, kind, area, fileName, parameterIds, exposedToLlm }) => ({ id, label, kind, area, fileName, parameterIds, exposedToLlm }))).toEqual([
      { id: 'mmd:0:', label: 'Morph 0', kind: 'system', area: 'hidden', fileName: '', parameterIds: [''], exposedToLlm: false },
      { id: 'mmd:1:  ', label: 'Morph 1', kind: 'system', area: 'hidden', fileName: '  ', parameterIds: ['  '], exposedToLlm: false },
      { id: 'mmd:2:smile', label: 'smile', kind: 'face', area: 'eyes', fileName: 'smile', parameterIds: ['smile'], exposedToLlm: true },
    ])
    expect(catalog.filter(isLlmEligible).map(entry => entry.id)).toEqual(['mmd:2:smile'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toBe(2)
  })

  it('keeps an entry for every repeated name and aliases the repeats to the first morph', () => {
    const catalog = deriveMMDCatalog([
      { index: 0, name: '笑い', category: 2, type: 1 },
      { index: 1, name: '', category: 4, type: 1 },
      { index: 2, name: '笑い', category: 2, type: 1 },
      { index: 3, name: '', category: 4, type: 1 },
      { index: 4, name: '笑い', category: 2, type: 1 },
    ])

    expect(catalog.map(entry => entry.id)).toEqual(['mmd:0:笑い', 'mmd:1:', 'mmd:2:笑い', 'mmd:3:', 'mmd:4:笑い'])
    expect(new Set(catalog.map(entry => entry.id)).size).toBe(5)
    expect(catalog[0].aliases).toEqual(['mmd:2:笑い', 'mmd:4:笑い'])
    expect(catalog.map(entry => entry.duplicateOf)).toEqual([undefined, undefined, 'mmd:0:笑い', 'mmd:1:', 'mmd:0:笑い'])
    expect(catalog.filter(isLlmEligible).map(entry => entry.id)).toEqual(['mmd:0:笑い'])
  })
})
