import { classes, decide } from '@proj-airi/cpu-slots'
import { describe, expect, it } from 'vitest'

import { RUN_LEASE_SLOTS } from './run'

describe('headless run lease', () => {
  it('lets six seeds hold their leases at once and still grants a unit-test file on the default budget', () => {
    const runs = Array.from({ length: 6 }, () => ({ slots: RUN_LEASE_SLOTS, exclusive: false }))
    const defaultBudget = 12
    const decision = decide({ leases: runs, tickets: [{ seq: 1, createdAt: 0, class: 'test', min: classes.test.min, max: classes.test.max, exclusive: false }] }, defaultBudget, 0)
    expect(decision).toMatchObject({ kind: 'grant', ticketSeq: 1 })
  })
})
