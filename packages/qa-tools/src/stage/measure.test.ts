import type { Lease } from '@proj-airi/cpu-slots'

import type { LiveProcess } from '../env/processes'

import process from 'node:process'

import { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { PassThrough } from 'node:stream'

import { acquire, Store } from '@proj-airi/cpu-slots'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as remoteDebug from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import { measurePairs } from './measure'

import * as brokerProcesses from '../../../cpu-slots/src/processes'
import * as pnpm from '../env/pnpm'
import * as processes from '../env/processes'

class FakeDevRoot extends ChildProcess {
  override stdin = new PassThrough()
  override stdout = new PassThrough()
  override stderr = new PassThrough()
  override readonly spawnargs = ['fake-dev-root']
  logOpened: Promise<unknown> = Promise.resolve()

  constructor(override readonly pid: number) {
    super()
    const pipe = this.stdout.pipe.bind(this.stdout)
    this.stdout.pipe = (destination, options) => {
      this.logOpened = once(destination, 'open')
      return pipe(destination, options)
    }
  }
}

let scratch: string
let store: Store
let outer: Lease | undefined
let child: FakeDevRoot
let live: LiveProcess[]
let launched: number
let startedAt: number
let killed: number[]

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'qa-measure-lease-'))
  mkdirSync(join(scratch, 'profile'))
  const root = join(scratch, 'broker')
  vi.stubEnv('AIRI_CPU_SLOTS_DIR', root)
  vi.stubEnv('AIRI_CPU_BUDGET', '12')
  vi.stubEnv('AIRI_CPU_SLOTS', '')
  vi.stubEnv('AIRI_CPU_LEASE', '')
  vi.stubEnv('AIRI_CPU_GRANT', '')
  vi.stubEnv('CI', '')
  vi.useFakeTimers()
  live = []
  launched = 0
  killed = []
  outer = undefined
  vi.spyOn(brokerProcesses, 'processStartedAt').mockImplementation(pid => pid === process.pid ? performance.timeOrigin : startedAt)
  vi.spyOn(brokerProcesses, 'snapshotProcesses').mockImplementation(() => ({
    platform: process.platform,
    processes: live.map(entry => ({ pid: entry.pid, ppid: entry.parentPid, pgid: child.pid, startedAt })),
  }))
  store = new Store({ root, budget: 12 })
  vi.spyOn(pnpm, 'spawnPnpm').mockImplementation((_args, options) => {
    launched += 1
    const pid = 800_000 + launched * 2
    child = new FakeDevRoot(pid)
    startedAt = Date.now()
    live = [
      { pid, parentPid: process.pid, created: startedAt, commandLine: `stage-tamagotchi ${scratch}` },
      { pid: pid + 1, parentPid: pid, created: startedAt, commandLine: `electron --user-data-dir=${options?.env?.APP_USER_DATA_PATH}` },
    ]
    return child
  })
  vi.spyOn(processes, 'listLiveProcesses').mockImplementation(async () => live)
  vi.spyOn(processes, 'killTree').mockImplementation(async (pid) => {
    killed.push(pid)
    live = live.filter(entry => entry.pid !== pid)
    return { pid, invocation: 'fake kill', exitCode: 0, output: '' }
  })
  vi.spyOn(remoteDebug, 'findAvailablePort').mockResolvedValue(9333)
  vi.spyOn(remoteDebug, 'waitForRemoteDebug').mockImplementation(async () => {
    await child.logOpened
    // The dev root exits while its process-group descendant survives until teardown.
    live = live.filter(entry => entry.pid !== child.pid)
    child.emit('exit', 1, null)
    return 'ws://fake-browser'
  })
  vi.spyOn(remoteDebug, 'findDebugTarget').mockRejectedValue(new Error('fake dev root exited'))
  vi.spyOn(remoteDebug.CdpClient, 'connect').mockRejectedValue(new Error('fake browser unavailable'))
  vi.spyOn(remoteDebug, 'sleep').mockImplementation(async (ms) => {
    vi.setSystemTime(Date.now() + ms)
  })
})

afterEach(() => {
  live = []
  outer?.release()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(scratch, { recursive: true, force: true })
})

describe('measurePairs lease lifecycle', () => {
  it('returns the lease when spawning the dev root throws', async () => {
    vi.mocked(pnpm.spawnPnpm).mockImplementation(() => {
      throw new Error('fake spawn failure')
    })

    const record = await measurePairs({
      repoRoot: scratch,
      profile: join(scratch, 'profile'),
      pairs: 1,
      seconds: 1,
      settleSeconds: 0,
      attempts: 1,
      selfPids: [process.pid],
      log: () => {},
      onRun: () => expect(store.snapshot().leases).toEqual([]),
    })

    expect(record.failures.map(failure => failure.error)).toEqual(['fake spawn failure', 'fake spawn failure'])
  })

  it('releases each launch after descendant teardown so all three pairs can launch', async () => {
    const record = await measurePairs({
      repoRoot: scratch,
      profile: join(scratch, 'profile'),
      pairs: 3,
      seconds: 1,
      settleSeconds: 0,
      attempts: 1,
      selfPids: [process.pid],
      log: () => {},
      onRun: () => {
        // Check before the next acquire: the old release lost its handle while this workload was alive.
        expect(store.snapshot().leases).toEqual([])
      },
    })

    expect(record.failures).toHaveLength(6)
    expect(launched).toBe(6)
    expect(killed).toEqual([800_003, 800_005, 800_007, 800_009, 800_011, 800_013])
    expect(readdirSync(join(scratch, 'broker', 'tickets'))).toEqual([])
  })

  it('balances retained launcher references so the outer gate release removes its lease file', async () => {
    outer = await acquire({ class: 'exclusive', command: 'gate --level t3', cwd: scratch })
    const leaseFile = `${outer.id}.json`

    await measurePairs({
      repoRoot: scratch,
      profile: join(scratch, 'profile'),
      pairs: 1,
      seconds: 1,
      settleSeconds: 0,
      attempts: 1,
      selfPids: [process.pid],
      log: () => {},
      onRun: () => expect(readdirSync(join(scratch, 'broker', 'leases'))).toEqual([leaseFile]),
    })
    outer.release()

    expect(killed).toEqual([800_003, 800_005])
    expect(readdirSync(join(scratch, 'broker', 'leases'))).toEqual([])
  })
})
