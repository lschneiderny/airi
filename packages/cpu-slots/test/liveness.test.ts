import type { WorkloadOwner } from '../src/liveness'
import type { ProcessRecord, ProcessSnapshot } from '../src/processes'

import { describe, expect, it, vi } from 'vitest'

import { isAlive, isSameProcess, workloadAlive } from '../src/liveness'
import { processStartedAt, snapshotProcesses } from '../src/processes'

const lease: WorkloadOwner = {
  pid: 10,
  startedAt: 1_000,
  createdAt: 10_000,
  workload: [{ pid: 20, startedAt: 11_000 }],
}

describe('process liveness', () => {
  it('uses signal zero without sending a terminating signal', () => {
    const kill = vi.fn()
    expect(isAlive(10, kill)).toBe(true)
    expect(kill).toHaveBeenCalledWith(10, 0)
  })

  it.each([
    ['ESRCH', false],
    ['EPERM', true],
  ] as const)('handles %s as alive=%s', (code, expected) => {
    expect(isAlive(10, () => {
      throw Object.assign(new Error(code), { code })
    })).toBe(expected)
  })

  it('does not turn an unexpected OS failure into a dead owner', () => {
    expect(() => isAlive(10, () => {
      throw new Error('OS failure')
    })).toThrow('OS failure')
  })

  it.each([
    [undefined, false],
    [8_000, true],
    [12_000, true],
    [7_999, false],
    [12_001, false],
  ] as const)('compares creation time %s with the two second tolerance', (actual, expected) => {
    expect(isSameProcess(20, 10_000, () => actual)).toBe(expected)
  })
})

describe('workloadAlive', () => {
  it.each(['win32', 'linux'] as const)('keeps a registered live workload on %s', (platform) => {
    expect(workloadAlive(lease, {
      platform,
      processes: [{ pid: 20, ppid: 1, startedAt: 11_000 }],
    })).toBe(true)
  })

  it.each(['win32', 'linux'] as const)('rejects a reused registered PID on %s', (platform) => {
    expect(workloadAlive(lease, {
      platform,
      processes: [{ pid: 20, ppid: 1, startedAt: 50_000 }],
    })).toBe(false)
  })

  it('keeps a Windows grandchild through a dead registered parent', () => {
    expect(workloadAlive(lease, {
      platform: 'win32',
      processes: [{ pid: 30, ppid: 20, startedAt: 12_000 }],
    })).toBe(true)
  })

  it('walks a longer Windows parent chain', () => {
    expect(workloadAlive(lease, {
      platform: 'win32',
      processes: [
        { pid: 30, ppid: 20, startedAt: 12_000 },
        { pid: 40, ppid: 30, startedAt: 13_000 },
      ],
    })).toBe(true)
  })

  it('keeps a POSIX group after its registered leader exits and children reparent', () => {
    expect(workloadAlive(lease, {
      platform: 'linux',
      processes: [{ pid: 30, ppid: 1, pgid: 20, startedAt: 12_000 }],
    })).toBe(true)
  })

  it.each(['win32', 'linux'] as const)('keeps unregistered owner descendants on %s', (platform) => {
    expect(workloadAlive({ ...lease, workload: [] }, {
      platform,
      processes: [{ pid: 30, ppid: 10, startedAt: 12_000 }],
    })).toBe(true)
  })

  it('does not count the owner itself, old processes, or unrelated processes', () => {
    const processes: ProcessRecord[] = [
      { pid: 10, ppid: 1, startedAt: 1_000 },
      { pid: 30, ppid: 20, startedAt: 9_999 },
      { pid: 40, ppid: 1, startedAt: 12_000 },
    ]
    expect(workloadAlive(lease, { platform: 'win32', processes })).toBe(false)
  })

  it('terminates on a cyclic parent chain', () => {
    expect(workloadAlive(lease, {
      platform: 'win32',
      processes: [{ pid: 30, ppid: 40, startedAt: 12_000 }, { pid: 40, ppid: 30, startedAt: 12_000 }],
    })).toBe(false)
  })

  it('does not claim to track POSIX grandchildren that detach again', () => {
    expect(workloadAlive(lease, {
      platform: 'linux',
      processes: [{ pid: 30, ppid: 1, pgid: 30, startedAt: 12_000 }],
    })).toBe(false)
  })

  it('does not attribute children of a later process that reused the owner pid', () => {
    expect(workloadAlive(lease, {
      platform: 'win32',
      processes: [
        { pid: 10, ppid: 1, startedAt: 15_000 },
        { pid: 30, ppid: 10, startedAt: 16_000 },
      ],
    })).toBe(false)
  })

  it('still counts an owner child created before a later process reused the owner pid', () => {
    expect(workloadAlive(lease, {
      platform: 'win32',
      processes: [
        { pid: 10, ppid: 1, startedAt: 17_000 },
        { pid: 30, ppid: 10, startedAt: 16_000 },
      ],
    })).toBe(true)
  })

  it('counts a workload descendant that was given the dead owner pid', () => {
    expect(workloadAlive(lease, {
      platform: 'win32',
      processes: [{ pid: 10, ppid: 20, startedAt: 12_000 }],
    })).toBe(true)
  })

  it('counts a POSIX child started in the same truncated second as the lease', () => {
    expect(workloadAlive({ ...lease, createdAt: 10_500 }, {
      platform: 'linux',
      processes: [{ pid: 30, ppid: 10, pgid: 30, startedAt: 10_000 }],
    })).toBe(true)
  })

  it('does not count a POSIX group led by a later process that reused a workload pid', () => {
    expect(workloadAlive(lease, {
      platform: 'linux',
      processes: [
        { pid: 20, ppid: 1, pgid: 20, startedAt: 14_000 },
        { pid: 30, ppid: 1, pgid: 20, startedAt: 15_000 },
      ],
    })).toBe(false)
  })

  it('returns false when the entire workload is gone', () => {
    expect(workloadAlive(lease, { platform: 'win32', processes: [] })).toBe(false)
  })
})

describe('dependency-free process commands', () => {
  it('parses Windows single-row and .NET date JSON', () => {
    const run = vi.fn(() => ({ stdout: '{"ProcessId":20,"ParentProcessId":10,"CreationDate":"/Date(11000)/"}' }))
    expect(snapshotProcesses('win32', run)).toEqual({
      platform: 'win32',
      processes: [{ pid: 20, ppid: 10, startedAt: 11_000 }],
    })
    expect(run.mock.calls[0]).toEqual([
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', expect.stringContaining('Get-CimInstance Win32_Process')],
    ])
  })

  it('parses Windows array JSON and ISO creation times', () => {
    expect(snapshotProcesses('win32', () => ({ stdout: '[{"ProcessId":20,"ParentProcessId":10,"CreationDate":"2026-10-21T00:00:00Z"}]' })))
      .toEqual({
        platform: 'win32',
        processes: [{ pid: 20, ppid: 10, startedAt: Date.parse('2026-10-21T00:00:00Z') }],
      })
  })

  it('parses POSIX pid, parent, process group, and lstart', () => {
    const run = vi.fn(() => ({ stdout: ' 20  10 20 Wed Oct 21 12:00:00 2026\n' }))
    const snapshot: ProcessSnapshot = snapshotProcesses('linux', run)
    expect(snapshot.processes).toEqual([{ pid: 20, ppid: 10, pgid: 20, startedAt: Date.parse('Wed Oct 21 12:00:00 2026') }])
    expect(run).toHaveBeenCalledWith('ps', ['-A', '-o', 'pid=,ppid=,pgid=,lstart='])
  })

  it.each(['win32', 'linux'] as const)('handles an empty snapshot on %s', (platform) => {
    expect(snapshotProcesses(platform, () => ({ stdout: '' })).processes).toEqual([])
  })

  it('reads a Windows PID creation date', () => {
    const run = vi.fn(() => ({ stdout: '{"CreationDate":"/Date(11000+0000)/"}' }))
    expect(processStartedAt(20, 'win32', run)).toBe(11_000)
    expect(run).toHaveBeenCalledWith('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      expect.stringContaining('ProcessId=20'),
    ])
    expect(processStartedAt(20, 'win32', () => ({ stdout: '' }))).toBeUndefined()
  })

  it('reads a POSIX creation date and distinguishes an exited PID from command failure', () => {
    expect(processStartedAt(20, 'linux', () => ({ stdout: 'Wed Oct 21 12:00:00 2026\n' })))
      .toBe(Date.parse('Wed Oct 21 12:00:00 2026'))
    expect(processStartedAt(20, 'linux', () => {
      throw Object.assign(new Error('gone'), { status: 1 })
    })).toBeUndefined()
    expect(() => processStartedAt(20, 'linux', () => {
      throw new Error('unavailable')
    })).toThrow('unavailable')
  })

  it('rejects invalid process ids before building the OS command', () => {
    const run = vi.fn(() => ({ stdout: '' }))
    expect(() => processStartedAt(-1, 'win32', run)).toThrow('Invalid process id')
    expect(run).not.toHaveBeenCalled()
  })

  it('excludes the snapshot probe and its children without dropping real owner children', () => {
    expect(snapshotProcesses('win32', () => ({
      pid: 50,
      stdout: JSON.stringify([
        { ProcessId: 10, ParentProcessId: 1, CreationDate: '/Date(1000)/' },
        { ProcessId: 20, ParentProcessId: 10, CreationDate: '/Date(11000)/' },
        { ProcessId: 50, ParentProcessId: 10, CreationDate: '/Date(12000)/' },
        { ProcessId: 60, ParentProcessId: 50, CreationDate: '/Date(12000)/' },
      ]),
    })).processes.map(info => info.pid)).toEqual([10, 20])
  })

  it('keeps a dead owner child when the probe reuses that owner pid', () => {
    expect(snapshotProcesses('win32', () => ({
      pid: 20,
      stdout: JSON.stringify([
        { ProcessId: 10, ParentProcessId: 4, CreationDate: '/Date(1000)/' },
        { ProcessId: 20, ParentProcessId: 10, CreationDate: '/Date(12050)/' },
        { ProcessId: 50, ParentProcessId: 20, CreationDate: '/Date(12010)/' },
      ]),
    })).processes.map(info => info.pid)).toEqual([10, 50])
  })

  it('follows a chain to the probe only through parents created no later than their child', () => {
    expect(snapshotProcesses('win32', () => ({
      pid: 50,
      stdout: JSON.stringify([
        { ProcessId: 10, ParentProcessId: 1, CreationDate: '/Date(1000)/' },
        { ProcessId: 50, ParentProcessId: 10, CreationDate: '/Date(12000)/' },
        { ProcessId: 60, ParentProcessId: 50, CreationDate: '/Date(13000)/' },
        { ProcessId: 70, ParentProcessId: 60, CreationDate: '/Date(12500)/' },
      ]),
    })).processes.map(info => info.pid)).toEqual([10, 70])
  })

  it('drops nothing when the probe is missing from its own listing', () => {
    expect(snapshotProcesses('win32', () => ({
      pid: 99,
      stdout: JSON.stringify([
        { ProcessId: 10, ParentProcessId: 1, CreationDate: '/Date(1000)/' },
        { ProcessId: 60, ParentProcessId: 99, CreationDate: '/Date(13000)/' },
      ]),
    })).processes.map(info => info.pid)).toEqual([10, 60])
  })

  it('excludes ps itself from a POSIX snapshot', () => {
    expect(snapshotProcesses('linux', () => ({
      pid: 50,
      stdout: '20 10 20 Wed Oct 21 12:00:00 2026\n50 10 50 Wed Oct 21 12:00:01 2026\n',
    })).processes.map(info => info.pid)).toEqual([20])
  })
})
