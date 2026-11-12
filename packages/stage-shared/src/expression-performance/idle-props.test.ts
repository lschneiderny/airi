import type { CatalogEntry } from './catalog'
import type { IdlePropInput, IdlePropMemory } from './idle-props'

import { describe, expect, it } from 'vitest'

import { decideIdleProp, IDLE_PROP_HOLD_MS, IDLE_PROP_REPEAT_MS, IDLE_PROP_REST_MS, idleActivityEntries, idleSleepEntryIds, initialIdlePropMemory } from './idle-props'

const game = { id: 'game', label: 'game' }
const snack = { id: 'eat', label: 'snack' }

/** Steps once a second from `fromMs` for `seconds`, and returns what started and ended, with the time in seconds. */
function run(memory: IdlePropMemory, fromMs: number, seconds: number, input: (nowMs: number) => Partial<IdlePropInput> = () => ({})) {
  const log: string[] = []
  for (let second = 0; second < seconds; second++) {
    const nowMs = fromMs + second * 1000
    const decision = decideIdleProp(memory, { nowMs, activities: [game, snack], free: true, pace: 1, seed: 7, ...input(nowMs) })
    memory = decision.memory
    if (decision.ended)
      log.push(`${Math.round((nowMs - fromMs) / 1000)} end ${decision.ended.id} ${decision.ended.reason}`)
    if (decision.started)
      log.push(`${Math.round((nowMs - fromMs) / 1000)} start ${decision.started.id}`)
  }
  return { memory, log }
}

describe('decideIdleProp', () => {
  it('picks pastimes up and puts them away, resting in between and never repeating one while another is offered', () => {
    const { log } = run(initialIdlePropMemory, 0, 4 * 3600)
    const starts = log.filter(line => line.includes('start'))
    const ends = log.filter(line => line.includes('end'))
    // About one pastime every 6 min of free time plus its length and the rest: 12 to 30 in four hours.
    expect(starts.length).toBeGreaterThan(12)
    expect(starts.length).toBeLessThan(30)
    expect(ends.every(line => line.endsWith('done'))).toBe(true)
    expect(Number(starts[0].split(' ')[0])).toBeGreaterThanOrEqual(IDLE_PROP_REST_MS / 1000)
    for (let index = 1; index < starts.length; index++)
      expect(starts[index].split(' ')[2]).not.toBe(starts[index - 1].split(' ')[2])
    log.forEach((line, index) => {
      if (!line.includes('end'))
        return
      const held = Number(line.split(' ')[0]) - Number(log[index - 1].split(' ')[0])
      expect(held).toBeGreaterThanOrEqual(IDLE_PROP_HOLD_MS.min / 1000)
      expect(held).toBeLessThanOrEqual(IDLE_PROP_HOLD_MS.max / 1000 + 1)
      if (log[index + 1])
        expect(Number(log[index + 1].split(' ')[0]) - Number(line.split(' ')[0])).toBeGreaterThanOrEqual(IDLE_PROP_REST_MS / 1000)
    })
  })

  it('replays the same decisions from the same memory and input', () => {
    expect(run(initialIdlePropMemory, 0, 3600).log).toEqual(run(initialIdlePropMemory, 0, 3600).log)
  })

  it('puts the pastime away as soon as she is not free, and counts no urge meanwhile', () => {
    const first = run(initialIdlePropMemory, 0, 3600, () => ({}))
    const startAt = Number(first.log[0].split(' ')[0])
    const interrupted = run(initialIdlePropMemory, 0, startAt + 600, nowMs => ({ free: nowMs / 1000 < startAt + 10 }))
    expect(interrupted.log).toEqual([first.log[0], `${startAt + 10} end ${first.log[0].split(' ')[2]} interrupted`])
    expect(interrupted.memory.urge).toBe(0)
  })

  it('ends a pastime whose entry is no longer offered, and repeats the only one left after its rest', () => {
    const first = run(initialIdlePropMemory, 0, 3600)
    const [at, , id] = first.log[0].split(' ')
    const other = id === 'game' ? snack : game
    const taken = run(initialIdlePropMemory, 0, Number(at) + 5, nowMs => ({ activities: nowMs / 1000 > Number(at) + 2 ? [other] : [game, snack] }))
    expect(taken.log.at(-1)).toBe(`${Number(at) + 3} end ${id} interrupted`)

    const only = run(initialIdlePropMemory, 0, 2 * 3600, () => ({ activities: [game] }))
    const starts = only.log.filter(line => line.includes('start'))
    expect(starts.length).toBeGreaterThan(3)
    // With one entry the repeat time cannot hold; the rest still does.
    expect(Number(starts[1].split(' ')[0]) - Number(starts[0].split(' ')[0])).toBeLessThan(IDLE_PROP_REPEAT_MS / 1000 + 3600)
  })

  it('starts nothing at pace 0, without candidates, or with a bad clock, and does not fire after a long pause', () => {
    expect(run(initialIdlePropMemory, 0, 3600, () => ({ pace: 0 })).log).toEqual([])
    expect(run(initialIdlePropMemory, 0, 3600, () => ({ activities: [] })).log).toEqual([])
    expect(decideIdleProp(initialIdlePropMemory, { nowMs: Number.NaN, activities: [game], free: true, pace: 1, seed: 1 })).toEqual({ memory: initialIdlePropMemory, started: null, ended: null })

    const warm = run(initialIdlePropMemory, 0, IDLE_PROP_REST_MS / 1000 + 2)
    expect(warm.log).toEqual([])
    // A stage that was hidden for an hour counts one second of it.
    const resumed = decideIdleProp(warm.memory, { nowMs: (warm.memory.nowMs ?? 0) + 3_600_000, activities: [game, snack], free: true, pace: 1, seed: 7 })
    expect(resumed.memory.urge - warm.memory.urge).toBeCloseTo(1000 / 360_000, 6)
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
