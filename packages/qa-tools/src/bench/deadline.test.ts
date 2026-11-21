import { describe, expect, it } from 'vitest'

import { BENCH_DEADLINE_EXIT, pastNotAfter } from './deadline'

describe('the --not-after launch check', () => {
  const notAfter = new Date('2026-11-21T06:00:00Z')

  it('lets every launch start without a deadline', () => {
    expect(pastNotAfter(null, new Date('2099-01-01T00:00:00Z'))).toBeNull()
  })

  it('lets a launch start at the deadline and refuses one after it', () => {
    expect(pastNotAfter(notAfter, notAfter)).toBeNull()
    expect(pastNotAfter(notAfter, new Date('2026-11-21T06:00:01Z'))).toContain('2026-11-21T06:00:00.000Z')
  })

  it('stops a three-launch bench before launch 2 with exit 4 and the one record it made', () => {
    const clock = [new Date('2026-11-21T05:59:00Z'), new Date('2026-11-21T06:01:00Z'), new Date('2026-11-21T06:02:00Z')]
    const records: number[] = []
    let exitCode = 0
    for (const [index, now] of clock.entries()) {
      if (pastNotAfter(notAfter, now) !== null) {
        exitCode = BENCH_DEADLINE_EXIT
        break
      }
      records.push(index + 1)
    }

    expect({ exitCode, records }).toEqual({ exitCode: 4, records: [1] })
  })
})
