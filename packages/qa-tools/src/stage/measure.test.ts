import type { LiveProcess } from '../env/processes'

import process from 'node:process'

import { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as remoteDebug from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import { heavyweightProcesses, measurePairs, topCpu } from './measure'

import * as pnpm from '../env/pnpm'
import * as processes from '../env/processes'
import * as hostQuiet from '../host-quiet/wait'

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
let child: FakeDevRoot
let live: LiveProcess[]
let launched: number
let killed: number[]

const calm = { load1: 0, cores: 8, externalCpuPct: 0, psiCpuSomeAvg10: 0 }

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'qa-measure-pairs-'))
  mkdirSync(join(scratch, 'profile'))
  vi.useFakeTimers()
  live = []
  launched = 0
  killed = []
  vi.spyOn(hostQuiet, 'waitForHostQuiet').mockResolvedValue({ quiet: true, waitedSeconds: 0, sample: calm })
  vi.spyOn(pnpm, 'spawnPnpm').mockImplementation((_args, options) => {
    launched += 1
    const pid = 800_000 + launched * 2
    child = new FakeDevRoot(pid)
    const startedAt = Date.now()
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
  vi.useRealTimers()
  vi.restoreAllMocks()
  rmSync(scratch, { recursive: true, force: true })
})

function pairOptions() {
  return {
    repoRoot: scratch,
    profile: join(scratch, 'profile'),
    seconds: 1,
    settleSeconds: 0,
    attempts: 1,
    selfPids: [process.pid],
    log: () => {},
    onRun: () => {},
  }
}

describe('measurePairs launch lifecycle', () => {
  it('records each launch whose spawn throws as a failed run', async () => {
    vi.mocked(pnpm.spawnPnpm).mockImplementation(() => {
      throw new Error('fake spawn failure')
    })

    const record = await measurePairs({ ...pairOptions(), pairs: 1 })

    expect(record.failures.map(failure => failure.error)).toEqual(['fake spawn failure', 'fake spawn failure'])
  })

  it('tears each launch down, descendants included, so all three pairs launch', async () => {
    const record = await measurePairs({ ...pairOptions(), pairs: 3 })

    expect(record.failures).toHaveLength(6)
    expect(launched).toBe(6)
    expect(killed).toEqual([800_003, 800_005, 800_007, 800_009, 800_011, 800_013])
  })

  it('waits for each run\'s process group to exit before the next launch', async () => {
    const calls = new Map<number, number>()
    vi.spyOn(processes, 'runGroupMembers').mockImplementation((rootPid) => {
      const seen = (calls.get(rootPid) ?? 0) + 1
      calls.set(rootPid, seen)
      return seen < 3 ? [{ pid: rootPid + 1, state: 'Z' }] : []
    })

    await measurePairs({ ...pairOptions(), pairs: 1 })

    expect([...calls.values()]).toEqual([3, 3])
  })

  it('refuses the launch and ends the pairs while the host stays busy', async () => {
    const busy = { load1: 9, cores: 8, externalCpuPct: 70, psiCpuSomeAvg10: 32 }
    vi.mocked(hostQuiet.waitForHostQuiet).mockResolvedValueOnce({ quiet: true, waitedSeconds: 0, sample: calm }).mockResolvedValue({ quiet: false, waitedSeconds: 1800, sample: busy })

    const record = await measurePairs({ ...pairOptions(), pairs: 3 })

    expect(launched).toBe(1)
    expect(record.failures).toHaveLength(2)
    expect(record.failures[1]).toMatchObject({ mode: 'desktop', n: 1, error: expect.stringContaining('load 9.00 on 8 cores') })
  })
})

describe('quiet-machine host probes', () => {
  it('never reads the host process table on Linux or Windows', async () => {
    const exec = vi.fn(async () => '12.0 Xorg\n')
    for (const os of ['linux', 'win32'] as const) {
      expect(await heavyweightProcesses(os, exec)).toBeNull()
      expect(await topCpu(os, exec)).toBeNull()
    }
    expect(exec).not.toHaveBeenCalled()
  })

  it('keeps the macOS pgrep and ps probes', async () => {
    const exec = vi.fn(async (command: string) => command === 'pgrep' ? '42 vitest\n' : '1.0 a\n9.5 b\n')
    expect(await heavyweightProcesses('darwin', exec)).toBe('42 vitest')
    expect(await topCpu('darwin', exec)).toEqual(['9.5 b', '1.0 a'])
    expect(exec.mock.calls.map(([command]) => command)).toEqual(['pgrep', 'ps'])
  })
})
