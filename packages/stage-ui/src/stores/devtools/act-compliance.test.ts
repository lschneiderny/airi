import type { ChatTurnCueStats } from '@proj-airi/core-agent'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  ACT_COMPLIANCE_HISTORY_MAX,
  ACT_COMPLIANCE_RATE_WINDOW,
  actComplianceOutcome,
  actComplianceRates,
  useActComplianceStore,
} from './act-compliance'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)

function cueStats(overrides: Partial<ChatTurnCueStats> = {}): ChatTurnCueStats {
  return { act: 0, recovered: 0, rejected: 0, origin: 'user', declined: false, ...overrides }
}

describe('act compliance store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('records parsed, recovered, none and rejected turns from stream ends and rejections', async () => {
    const store = useActComplianceStore()

    store.recordStreamEnd({ turnId: 'parsed', cueStats: cueStats({ act: 1 }) }, T0)
    store.recordStreamEnd({ turnId: 'recovered', cueStats: cueStats({ act: 1, recovered: 1 }) }, T0 + 1)
    store.recordStreamEnd({ turnId: 'none', cueStats: cueStats() }, T0 + 2)
    store.recordStreamEnd({ turnId: 'banana', cueStats: cueStats({ act: 1 }) }, T0 + 3)
    // Speech dispatches the marker while it plays, after the stream ended.
    store.recordRejected('banana', '<|ACT banana|>')

    const { records } = await store.inspect()
    expect(records.map(record => [record.turnId, actComplianceOutcome(record), record.noAct])).toEqual([
      ['banana', 'rejected', false],
      ['none', 'none', true],
      ['recovered', 'recovered', false],
      ['parsed', 'parsed', false],
    ])
    expect(records[0]).toMatchObject({ rejected: 1, rejectedTokens: ['<|ACT banana|>'] })
    expect(actComplianceRates(records)).toEqual({ turns: 4, declined: 0, parsed: 1, recovered: 1, rejected: 1, none: 1 })
  })

  it('keeps a rejection that arrives before its stream end', () => {
    const store = useActComplianceStore()

    store.recordRejected('muted', '<|ACT 2|>')
    store.recordStreamEnd({ turnId: 'muted', cueStats: cueStats({ act: 1, recovered: 1 }) }, T0)
    store.recordStreamEnd({ turnId: 'next', cueStats: cueStats({ act: 1 }) }, T0 + 1)

    // A recovered marker-shaped cue that the stage rejects is rejected; bracketed prose such as `[Act 2]` is never recovered.
    expect(store.records[1]).toMatchObject({ turnId: 'muted', recovered: 1, rejected: 1, rejectedTokens: ['<|ACT 2|>'] })
    expect(actComplianceOutcome(store.records[1])).toBe('rejected')
    // The early rejection belongs to its turn only.
    expect(store.records[0]).toMatchObject({ turnId: 'next', rejected: 0, rejectedTokens: [] })
  })

  it('counts a turn whose only cues the runtime stripped as rejected, below native and recovered cues', async () => {
    const store = useActComplianceStore()

    store.recordStreamEnd({ turnId: 'stripped', cueStats: cueStats({ rejected: 1 }) }, T0)
    store.recordStreamEnd({ turnId: 'parsed-and-stripped', cueStats: cueStats({ act: 1, rejected: 1 }) }, T0 + 1)
    store.recordStreamEnd({ turnId: 'recovered-and-stripped', cueStats: cueStats({ act: 1, recovered: 1, rejected: 2 }) }, T0 + 2)
    store.recordStreamEnd({ turnId: 'declined-stripped', cueStats: cueStats({ origin: 'unprompted', declined: true, rejected: 1 }) }, T0 + 3)

    const { records } = await store.inspect()
    // `stripped` comes from the runtime's cue stats; `rejected` stays the stage controller's count.
    expect(records.map(record => [record.turnId, actComplianceOutcome(record), record.stripped, record.rejected, record.noAct])).toEqual([
      ['declined-stripped', 'rejected', 1, 0, true],
      ['recovered-and-stripped', 'recovered', 2, 0, false],
      ['parsed-and-stripped', 'parsed', 1, 0, false],
      ['stripped', 'rejected', 1, 0, true],
    ])
    expect(actComplianceRates(records)).toEqual({ turns: 3, declined: 1, parsed: 1, recovered: 1, rejected: 1, none: 0 })
  })

  it('ignores a stream end without cue stats and a repeated stream end of the same turn', () => {
    const store = useActComplianceStore()

    store.recordStreamEnd({ turnId: 'no-stats' }, T0)
    store.recordStreamEnd({ turnId: 'turn-1', cueStats: cueStats({ act: 1 }) }, T0)
    store.recordStreamEnd({ turnId: 'turn-1', cueStats: cueStats() }, T0 + 1)

    expect(store.records.map(record => [record.turnId, record.act])).toEqual([['turn-1', 1]])
  })

  it('excludes declined turns from every rate, including none', () => {
    const store = useActComplianceStore()

    store.recordStreamEnd({ turnId: 'declined', cueStats: cueStats({ origin: 'unprompted', declined: true }) }, T0)
    store.recordStreamEnd({ turnId: 'spoken', cueStats: cueStats({ origin: 'unprompted', act: 1 }) }, T0 + 1)

    expect(store.records.find(record => record.turnId === 'declined')).toMatchObject({ declined: true, noAct: true, origin: 'unprompted' })
    expect(actComplianceRates(store.records)).toEqual({ turns: 1, declined: 1, parsed: 1, recovered: 0, rejected: 0, none: 0 })
  })

  it('keeps the newest turns and computes rates over the newest window only', () => {
    const store = useActComplianceStore()

    const total = ACT_COMPLIANCE_HISTORY_MAX + 20
    for (let index = 0; index < total; index++) {
      // The oldest turns have no ACT, the newest window has one in every turn.
      const act = index >= total - ACT_COMPLIANCE_RATE_WINDOW ? 1 : 0
      store.recordStreamEnd({ turnId: `turn-${index}`, cueStats: cueStats({ act }) }, T0 + index)
    }

    expect(store.records).toHaveLength(ACT_COMPLIANCE_HISTORY_MAX)
    expect(store.records[0].turnId).toBe(`turn-${total - 1}`)
    expect(store.records.at(-1)?.turnId).toBe(`turn-${total - ACT_COMPLIANCE_HISTORY_MAX}`)
    expect(actComplianceRates(store.records)).toEqual({ turns: ACT_COMPLIANCE_RATE_WINDOW, declined: 0, parsed: ACT_COMPLIANCE_RATE_WINDOW, recovered: 0, rejected: 0, none: 0 })
  })

  it('caps the rejected tokens of a turn but counts every rejection', () => {
    const store = useActComplianceStore()
    store.recordStreamEnd({ turnId: 'noisy', cueStats: cueStats({ act: 8 }) }, T0)

    for (let index = 0; index < 8; index++)
      store.recordRejected('noisy', `<|ACT bad-${index}|>`)

    expect(store.records[0].rejected).toBe(8)
    expect(store.records[0].rejectedTokens).toHaveLength(5)
  })
})
