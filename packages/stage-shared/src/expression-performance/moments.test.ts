import type { CatalogEntry } from './catalog'

import { describe, expect, it } from 'vitest'

import { chooseMomentEntry, MOMENT_SETTINGS, momentCoverage, momentEntries } from './moments'

const wink = { id: 'wink', label: 'Wink', moments: ['check-in', 'welcome-back'] as const }
const tongue = { id: 'tongue', label: 'Tongue out', moments: ['check-in', 'peering'] as const }
const often = MOMENT_SETTINGS.chance - 0.01

describe('chooseMomentEntry', () => {
  it('marks a share of the moments with an entry tagged for them, and lets the others pass', () => {
    expect(chooseMomentEntry([wink, tongue], 'welcome-back', {}, { nowMs: 0, chance: often, pick: 0.9 })).toEqual(wink)
    expect(chooseMomentEntry([wink, tongue], 'check-in', {}, { nowMs: 0, chance: often, pick: 0.9 })).toEqual(tongue)
    expect(chooseMomentEntry([wink, tongue], 'check-in', {}, { nowMs: 0, chance: MOMENT_SETTINGS.chance, pick: 0 })).toBeNull()
    expect(chooseMomentEntry([wink, tongue], 'poked', {}, { nowMs: 0, chance: 0, pick: 0 })).toBeNull()
  })

  it('rests an entry after it marked a moment', () => {
    const history = { wink: 1000 }
    expect(chooseMomentEntry([wink, tongue], 'check-in', history, { nowMs: 2000, chance: 0, pick: 0 })).toEqual(tongue)
    expect(chooseMomentEntry([wink], 'check-in', history, { nowMs: 2000, chance: 0, pick: 0 })).toBeNull()
    expect(chooseMomentEntry([wink], 'check-in', history, { nowMs: 1000 + MOMENT_SETTINGS.entryRestMs, chance: 0, pick: 0 })).toEqual(wink)
  })

  it('shows a forced moment whatever the chance and the rest', () => {
    expect(chooseMomentEntry([wink], 'check-in', { wink: 1000 }, { nowMs: 2000, chance: 0.99, pick: 0, force: true })).toEqual(wink)
    expect(chooseMomentEntry([wink], 'poked', {}, { nowMs: 0, chance: 0, pick: 0, force: true })).toBeNull()
  })
})

describe('moment catalog entries', () => {
  const entry = (id: string, patch: Partial<CatalogEntry>): CatalogEntry => ({ id, label: id, kind: 'face', group: null, confirmed: true, exposedToLlm: false, mappings: [], fileName: `${id}.exp3.json`, parameterIds: [], ...patch })

  it('offers only tagged entries, and never a reversed switch, a hidden duplicate or a system entry', () => {
    const catalog = [
      entry('wink', { moments: ['check-in'] }),
      entry('blush', { moments: ['petted', 'check-in'], kind: 'effect' }),
      entry('smile', {}),
      entry('none', { moments: [] }),
      entry('reversed', { moments: ['poked'], inverted: true }),
      entry('copy', { moments: ['poked'], duplicateOf: 'wink' }),
      entry('watermark', { moments: ['poked'], kind: 'system' }),
    ]
    expect(momentEntries(catalog).map(candidate => candidate.id)).toEqual(['wink', 'blush'])
    const coverage = momentCoverage(catalog)
    expect(coverage['check-in']).toEqual(['wink', 'blush'])
    expect(coverage.petted).toEqual(['blush'])
    expect(coverage.poked).toEqual([])
  })
})
