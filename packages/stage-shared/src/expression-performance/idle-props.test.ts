import type { CatalogEntry } from './catalog'

import { describe, expect, it } from 'vitest'

import { choosePastime, IDLE_PROP_REPEAT_MS, idleActivityEntries, idleSleepEntryIds } from './idle-props'

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
})
