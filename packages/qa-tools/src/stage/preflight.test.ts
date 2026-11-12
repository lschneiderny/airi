import type { Status } from '@proj-airi/cpu-slots'

import { describe, expect, it } from 'vitest'

import { exclusiveRefusal, waitForQuiet } from './preflight'

type BrokerLease = Status['leases'][number]

const repoRoot = '/wt/tools2'

function lease(id: string, overrides: Partial<BrokerLease>): BrokerLease {
  return { id, class: 'test', slots: 4, exclusive: false, cwd: '/wt/other', command: 'vitest run', pid: 100, startedAt: 0, createdAt: 0, workload: [], age: 30_000, ...overrides }
}

const ownApp = lease('app', { class: 'live', cwd: repoRoot, command: 'qa:app run --model chisa.pmx' })
const otherVerify = lease('verify', { class: 'typecheck', cwd: '/wt/other', command: 'verify typecheck' })
const otherApp = lease('other-app', { class: 'live', cwd: '/wt/other', command: 'qa:app run' })

/** Replays broker states in order, one per read, on a clock that the injected sleep advances. */
function replay(states: BrokerLease[][]) {
  let clock = 0
  let reads = 0
  return {
    read: () => states[Math.min(reads++, states.length - 1)],
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms
    },
    reads: () => reads,
  }
}

describe('waitForQuiet', () => {
  it('is quiet at once when only this checkout\'s app session holds a lease', async () => {
    const broker = replay([[ownApp]])

    const result = await waitForQuiet({ ...broker, repoRoot, waitSeconds: 0 })

    expect(result).toMatchObject({ quiet: true, waitedSeconds: 0, busy: [], ownApp: [{ id: 'app' }] })
  })

  it('refuses at once without a wait, listing every competing lease, including another worktree\'s app', async () => {
    const broker = replay([[ownApp, otherVerify, otherApp]])

    const result = await waitForQuiet({ ...broker, repoRoot, waitSeconds: 0 })

    expect(result.quiet).toBe(false)
    expect(result.busy.map(item => item.id)).toEqual(['verify', 'other-app'])
    expect(broker.reads()).toBe(1)
  })

  it('waits until the competing leases end, within the wait', async () => {
    const broker = replay([[ownApp, otherVerify], [ownApp, otherVerify], [ownApp]])

    const result = await waitForQuiet({ ...broker, repoRoot, waitSeconds: 60, pollMs: 2000 })

    expect(result).toMatchObject({ quiet: true, waitedSeconds: 4 })
  })

  it('gives up after the wait and reports the holders still there', async () => {
    const broker = replay([[otherVerify]])

    const result = await waitForQuiet({ ...broker, repoRoot, waitSeconds: 5, pollMs: 2000 })

    expect(result).toMatchObject({ quiet: false, waitedSeconds: 5, busy: [{ id: 'verify' }] })
  })
})

describe('exclusiveRefusal', () => {
  it('refuses an exclusive lease while this checkout\'s app session holds its live lease', async () => {
    expect(exclusiveRefusal(await waitForQuiet({ ...replay([[ownApp]]), repoRoot, waitSeconds: 0 }))).toContain('qa:app run --model chisa.pmx')
    expect(exclusiveRefusal(await waitForQuiet({ ...replay([[]]), repoRoot, waitSeconds: 0 }))).toBeNull()
  })
})
