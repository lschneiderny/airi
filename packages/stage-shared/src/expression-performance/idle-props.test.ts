import type { CatalogEntry } from './catalog'

import { describe, expect, it } from 'vitest'

import { choosePastime, IDLE_PROP_REPEAT_MS, idleActivityEntries, idleSleepEntryIds, occasionCoverage } from './idle-props'

const game = { id: 'game', label: 'game' }
const snack = { id: 'eat', label: 'snack' }

describe('choosePastime', () => {
  it('never picks the same pastime twice in a row, nor within the repeat time, while another one is offered', () => {
    const history = { lastId: 'game', heldAtMs: { game: 0, eat: 0 } }
    for (const pick of [0, 0.5, 0.99])
      expect(choosePastime([game, snack], history, { nowMs: 60_000, pick })).toEqual(snack)
    const rested = { lastId: 'eat', heldAtMs: { game: 0, eat: IDLE_PROP_REPEAT_MS } }
    expect(choosePastime([game, snack], rested, { nowMs: IDLE_PROP_REPEAT_MS + 1, pick: 0.99 })).toEqual(game)
  })

  it('repeats the only pastime left, picks by the draw among the rested, and offers nothing without candidates', () => {
    expect(choosePastime([game], { lastId: 'game', heldAtMs: { game: 0 } }, { nowMs: 1_000, pick: 0.3 })).toEqual(game)
    const fresh = { lastId: null, heldAtMs: {} }
    expect(choosePastime([game, snack], fresh, { nowMs: 0, pick: 0.2 })).toEqual(game)
    expect(choosePastime([game, snack], fresh, { nowMs: 0, pick: 0.7 })).toEqual(snack)
    expect(choosePastime([], fresh, { nowMs: 0, pick: 0 })).toBeNull()
  })

  const bread = { id: 'bread', label: 'bread', occasions: ['morning'] as const }
  const pad = { id: 'pad', label: 'controller', occasions: ['gaming', 'media'] as const }

  it('offers a tagged pastime only during one of its occasions, and picks it first then', () => {
    const fresh = { lastId: null, heldAtMs: {} }
    for (const pick of [0, 0.5, 0.99]) {
      expect(choosePastime([game, bread, snack], fresh, { nowMs: 0, pick, occasions: ['morning', 'music'] })).toEqual(bread)
      expect(choosePastime([game, bread, snack], fresh, { nowMs: 0, pick, occasions: ['gaming'] })).not.toEqual(bread)
      expect(choosePastime([game, bread, pad], fresh, { nowMs: 0, pick, occasions: ['media'] })).toEqual(pad)
    }
    expect(choosePastime([bread, pad], fresh, { nowMs: 0, pick: 0 })).toBeNull()
    expect(choosePastime([bread], fresh, { nowMs: 0, pick: 0, occasions: ['lunchtime'] })).toBeNull()
  })

  it('keeps the repeat rule during an occasion: something else comes between two breakfasts', () => {
    const justHad = { lastId: 'bread', heldAtMs: { bread: 0 } }
    expect(choosePastime([game, bread], justHad, { nowMs: 60_000, pick: 0.9, occasions: ['morning'] })).toEqual(game)
    const later = { lastId: 'game', heldAtMs: { bread: 0, game: 400_000 } }
    expect(choosePastime([game, bread], later, { nowMs: IDLE_PROP_REPEAT_MS, pick: 0, occasions: ['morning'] })).toEqual(bread)
    // With nothing else to do during the occasion she keeps to it.
    expect(choosePastime([bread], justHad, { nowMs: 60_000, pick: 0, occasions: ['morning'] })).toEqual(bread)
  })
})

describe('idle catalog entries', () => {
  const entry = (id: string, patch: Partial<CatalogEntry>): CatalogEntry => ({ id, label: id, kind: 'prop', group: null, confirmed: true, exposedToLlm: false, mappings: [], fileName: `${id}.exp3.json`, parameterIds: [], ...patch })

  it('offers only what the user allowed, and never a reversed switch, a hidden duplicate or a system entry', () => {
    const catalog = [
      entry('game', { idleUse: 'activity', label: 'handheld' }),
      entry('pillow', { idleUse: 'sleep' }),
      entry('bubble', { idleUse: 'sleep', kind: 'effect' }),
      entry('glasses', {}),
      entry('hat', { idleUse: 'never' }),
      entry('reversed', { idleUse: 'activity', inverted: true }),
      entry('copy', { idleUse: 'sleep', duplicateOf: 'pillow' }),
      entry('watermark', { idleUse: 'activity', kind: 'system' }),
    ]
    expect(idleActivityEntries(catalog)).toEqual([{ id: 'game', label: 'handheld' }])
    expect(idleSleepEntryIds(catalog)).toEqual(['pillow', 'bubble'])
  })

  it('carries the occasions of a pastime, and lists which pastimes cover each occasion', () => {
    const catalog = [
      entry('bread', { idleUse: 'activity', occasions: ['morning', 'lunchtime'] }),
      entry('game', { idleUse: 'activity', occasions: [] }),
      entry('pillow', { idleUse: 'sleep', occasions: ['late-night'] }),
    ]
    expect(idleActivityEntries(catalog)).toEqual([{ id: 'bread', label: 'bread', occasions: ['morning', 'lunchtime'] }, { id: 'game', label: 'game' }])
    const coverage = occasionCoverage(catalog)
    expect(coverage.morning).toEqual(['bread'])
    expect(coverage.lunchtime).toEqual(['bread'])
    // Occasions gate pastimes only, so what she sleeps with covers none.
    expect(coverage['late-night']).toEqual([])
  })
})
