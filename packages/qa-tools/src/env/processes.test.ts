import type { LiveProcess, SessionProcessReaders } from './processes'

import { execFile } from 'node:child_process'

import { describe, expect, it, vi } from 'vitest'

import { commandLineContainsPath, descendantsOf, killOwnedTree, listLiveProcesses, listSessionProcesses, parsePosixProcessListing, parseProcStatParent, parseWindowsProcessListing, treeKillCommand } from './processes'

// Every process spawn in this file is a stub, so a lister that wrongly falls back to `ps` fails here instead of reading the host.
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: vi.fn(() => {
    throw new Error('host process listing spawned')
  }),
}))

describe('commandLineContainsPath', () => {
  it('matches a worktree path regardless of slashes and case', () => {
    expect(commandLineContainsPath('node C:\\Users\\Luke\\wt\\qa-tooling-t11\\node_modules\\x.js', 'c:/users/luke/wt/qa-tooling-t11')).toBe(true)
    expect(commandLineContainsPath('"C:/Users/Luke/wt/qa-tooling-t11" dev', 'C:/Users/Luke/wt/qa-tooling-t11/')).toBe(true)
  })

  it('does not match a sibling worktree whose name extends the path', () => {
    expect(commandLineContainsPath('node C:\\wt\\qa-tooling-t11\\x.js', 'C:/wt/qa-tooling')).toBe(false)
    expect(commandLineContainsPath('electron.exe --user-data-dir=C:\\wt\\situational-presence2\\p', 'C:/wt/situational-presence')).toBe(false)
  })

  const root = 'C:/Users/Luke/projects/dtuber-wt/qa-tooling-t11'

  it('rejects a quoted sibling worktree named "<root> copy"', () => {
    expect(commandLineContainsPath(`"${root} copy/node_modules/electron/dist/electron.exe" .`, root)).toBe(false)
    expect(commandLineContainsPath(`node pnpm.mjs --dir "${root} copy" dev`, root)).toBe(false)
  })

  it('rejects a sibling worktree named "<root>-x"', () => {
    expect(commandLineContainsPath(`${root}-x\\node_modules\\electron\\dist\\electron.exe .`, root)).toBe(false)
  })

  it('accepts the same path in another case or slash style, as an argument, inside it, or after an option', () => {
    expect(commandLineContainsPath('node pnpm.mjs --dir C:\\USERS\\luke\\projects\\dtuber-wt\\QA-TOOLING-T11 -F x dev', root)).toBe(true)
    expect(commandLineContainsPath(`"${root.replaceAll('/', '\\')}\\node_modules\\electron\\dist\\electron.exe" .`, root)).toBe(true)
    expect(commandLineContainsPath(`electron.exe --user-data-dir=${root}/.temp/qa/run/profile`, `${root}/.temp/qa/run/profile`)).toBe(true)
  })

  it('rejects an unrelated process', () => {
    expect(commandLineContainsPath('C:\\Windows\\System32\\svchost.exe -k netsvcs', root)).toBe(false)
    expect(commandLineContainsPath('godot.exe --path C:\\Users\\Luke\\projects\\dtuber-wt\\situational-presence', root)).toBe(false)
  })
})

describe('descendantsOf', () => {
  const listing: LiveProcess[] = [
    { pid: 10, parentPid: 1, commandLine: 'root', created: 100 },
    { pid: 11, parentPid: 10, commandLine: 'child', created: 110 },
    { pid: 12, parentPid: 11, commandLine: 'grandchild', created: 120 },
    // Its parent PID 10 was reused by the root after this process started, so it is not the root's child.
    { pid: 13, parentPid: 10, commandLine: 'older orphan', created: 50 },
  ]

  it('follows parent links and skips links to a parent created later than the child', () => {
    expect(descendantsOf(listing, { pid: 10, created: 100 }).map(entry => entry.pid)).toEqual([11, 12])
  })
})

describe('listing parsers', () => {
  it('parses Get-CimInstance JSON for one or many rows', () => {
    expect(parseWindowsProcessListing('{"ProcessId":4,"ParentProcessId":0,"CommandLine":null,"Created":7}')).toEqual([{ pid: 4, parentPid: 0, commandLine: '', created: 7 }])
    expect(parseWindowsProcessListing('[{"ProcessId":4,"ParentProcessId":1,"CommandLine":"a b","Created":null}]')).toEqual([{ pid: 4, parentPid: 1, commandLine: 'a b', created: undefined }])
  })

  it('parses ps output', () => {
    expect(parsePosixProcessListing('  12     1 node a.js\n 13 12 electron .\n')).toEqual([
      { pid: 12, parentPid: 1, commandLine: 'node a.js' },
      { pid: 13, parentPid: 12, commandLine: 'electron .' },
    ])
  })
})

describe('treeKillCommand', () => {
  it('builds taskkill on Windows and a process-group kill elsewhere', () => {
    expect(treeKillCommand(42, 'win32')).toEqual({ command: 'taskkill', args: ['/PID', '42', '/T', '/F'] })
    expect(treeKillCommand(42, 'linux')).toEqual({ command: 'kill', args: ['-KILL', '-42'] })
    expect(() => treeKillCommand(0, 'win32')).toThrow(/Refusing/)
  })
})

describe('killOwnedTree', () => {
  const kills: number[] = []
  const deps = (listing: LiveProcess[]) => ({
    list: async () => listing,
    kill: async (pid: number) => {
      kills.push(pid)
      return { pid, invocation: `taskkill /PID ${pid} /T /F`, exitCode: 0, output: 'SUCCESS' }
    },
  })

  it('kills only after the live command line proves ownership', async () => {
    kills.length = 0
    const receipt = await killOwnedTree({ pid: 5, created: 1 }, { ownedPaths: ['C:/wt/mine'] }, deps([{ pid: 5, parentPid: 1, created: 1, commandLine: 'node pnpm.mjs --dir C:\\wt\\mine dev' }]))
    expect(receipt).toMatchObject({ pid: 5, exitCode: 0 })
    expect(kills).toEqual([5])
  })

  it('refuses a reused PID that now runs a foreign command, and skips a reused PID with another creation time', async () => {
    kills.length = 0
    await expect(killOwnedTree({ pid: 5, created: 1 }, { ownedPaths: ['C:/wt/mine'] }, deps([{ pid: 5, parentPid: 1, created: 1, commandLine: 'godot.exe C:\\wt\\situational-presence' }]))).rejects.toThrow(/Refusing to kill PID 5/)
    expect(await killOwnedTree({ pid: 5, created: 1 }, { ownedPaths: ['C:/wt/mine'] }, deps([{ pid: 5, parentPid: 1, created: 2, commandLine: 'node C:\\wt\\mine\\x' }]))).toBeNull()
    expect(kills).toEqual([])
  })

  it('refuses, without calling the killer, a process of a sibling worktree whose path extends the root with a space', async () => {
    kills.length = 0
    const root = 'C:/Users/Luke/projects/dtuber-wt/qa-tooling-t11'
    const foreign = { pid: 987654, parentPid: 1, created: 4, commandLine: `"${root} copy/node_modules/electron/dist/electron.exe" .` }
    await expect(killOwnedTree(foreign, { ownedPaths: [root] }, deps([foreign]))).rejects.toThrow(/Refusing to kill PID 987654/)
    expect(kills).toEqual([])
  })
})

describe('listSessionProcesses', () => {
  const service = '/user.slice/user-1000.slice/user@1000.service/app.slice/airi-qa-display-lsp.service'
  const scope = '/user.slice/user-1000.slice/user@1000.service/app.slice/airi-qa-display-lsp.run-77.scope'
  const show = (active = 'active', serviceCgroup = service) => [
    `Id=airi-qa-display-lsp.service\nActiveState=${active}\nControlGroup=${serviceCgroup}`,
    `Id=airi-qa-display-lsp.run-77.scope\nActiveState=active\nControlGroup=${scope}`,
    // A run scope of another session must never widen the set, even if a pattern returned it.
    'Id=airi-qa-display-other.run-5.scope\nActiveState=active\nControlGroup=/user.slice/x/airi-qa-display-other.run-5.scope',
  ].join('\n\n')
  // PID 900 is a host process whose command line names the worktree, as an Electron of the user's own session would.
  const procs: Record<number, { parent: number, cmdline: string }> = {
    100: { parent: 1, cmdline: 'kwin_wayland\0--virtual' },
    101: { parent: 100, cmdline: 'Xwayland\0:1' },
    200: { parent: 1, cmdline: 'electron\0/wt/lsp/node_modules/electron/dist/electron\0.' },
    300: { parent: 50, cmdline: 'node\0smoke.ts' },
    301: { parent: 300, cmdline: 'pnpm\0dev' },
    302: { parent: 301, cmdline: '/wt/lsp/node_modules/electron/dist/electron\0.' },
    303: { parent: 300, cmdline: 'sleep\u0000300' },
    900: { parent: 1, cmdline: '/wt/lsp/node_modules/electron/dist/electron\0.' },
  }
  const readers = (overrides: Partial<SessionProcessReaders> = {}): SessionProcessReaders & { showCalls: string[][] } => {
    const showCalls: string[][] = []
    return {
      showCalls,
      showUnits: async (units) => {
        showCalls.push([...units])
        return show()
      },
      readCgroupProcs: cgroup => ({ [service]: '100\n', [`${service}/portals`]: '101\n', [scope]: '200\n' } as Record<string, string>)[cgroup] ?? null,
      listCgroupChildren: cgroup => cgroup === service ? ['portals'] : [],
      // Two threads of the caller each own a child; 303 is listed twice and kept once.
      readTaskChildren: pid => ({ 300: ['301 ', '303 '], 301: ['302 303 '] } as Record<number, string[]>)[pid] ?? [],
      readStat: pid => procs[pid] ? `${pid} (a (b) c) S ${procs[pid].parent} 1 1` : null,
      readCmdline: pid => procs[pid] ? `${procs[pid].cmdline}\0` : null,
      ...overrides,
    }
  }
  const env = { AIRI_QA_DISPLAY_SESSION: 'lsp' }

  it('returns the session cgroups, their child cgroups, the run scopes, and the caller descendants, and nothing else', async () => {
    const r = readers()
    const listed = await listSessionProcesses(env, 300, r)
    expect(listed.map(entry => entry.pid)).toEqual([100, 101, 200, 301, 302, 303])
    expect(listed.find(entry => entry.pid === 302)).toEqual({ pid: 302, parentPid: 301, commandLine: '/wt/lsp/node_modules/electron/dist/electron .' })
    expect(r.showCalls).toEqual([['airi-qa-display-lsp.service', 'airi-qa-display-lsp.run-*.scope']])
  })

  it('refuses without a session marker or with a marker that is not a session name, before asking systemd', async () => {
    const r = readers()
    await expect(listSessionProcesses({}, 300, r)).rejects.toThrow(/AIRI_QA_DISPLAY_SESSION is not set/)
    await expect(listSessionProcesses({ AIRI_QA_DISPLAY_SESSION: '../x' }, 300, r)).rejects.toThrow(/is not a qa:display session name/)
    expect(r.showCalls).toEqual([])
  })

  it.each(['inactive', 'failed', 'deactivating'])('refuses a stale marker whose session unit is %s', async (state) => {
    await expect(listSessionProcesses(env, 300, readers({ showUnits: async () => show(state) }))).rejects.toThrow(/session "lsp" is not running/)
  })

  it('refuses when systemd does not report the session unit at all', async () => {
    await expect(listSessionProcesses(env, 300, readers({ showUnits: async () => '' }))).rejects.toThrow(/is not running/)
  })

  it.each([
    ['an empty ControlGroup', ''],
    ['a relative path', 'user.slice/x.service'],
    ['a parent segment', '/user.slice/../../etc'],
    ['garbage', '/x;rm -rf'],
  ])('refuses %s for an active session unit', async (_label, cgroup) => {
    await expect(listSessionProcesses(env, 300, readers({ showUnits: async () => show('active', cgroup) }))).rejects.toThrow(/unusable ControlGroup/)
  })

  it('refuses a cgroup.procs or children file that is not a PID list', async () => {
    await expect(listSessionProcesses(env, 300, readers({ readCgroupProcs: () => '100\nabc\n' }))).rejects.toThrow(/Unexpected PID/)
    await expect(listSessionProcesses(env, 300, readers({ readTaskChildren: () => ['-1'] }))).rejects.toThrow(/Unexpected PID/)
  })

  it('skips a process that exits between the cgroup read and its /proc read', async () => {
    const r = readers({ readCmdline: pid => pid === 200 ? null : procs[pid] ? procs[pid].cmdline : null })
    expect((await listSessionProcesses(env, 300, r)).map(entry => entry.pid)).not.toContain(200)
  })
})

describe('parseProcStatParent', () => {
  it('reads the parent after a command name that holds spaces and parentheses', () => {
    expect(parseProcStatParent('42 (we(ir) d) S 7 42 42 0')).toBe(7)
    expect(parseProcStatParent('garbage')).toBeNull()
  })
})

describe('listLiveProcesses platform routing', () => {
  it('routes Linux to the session lister, which refuses without a session and never spawns ps', async () => {
    vi.mocked(execFile).mockClear()
    await expect(listLiveProcesses(1_000, 'linux', {})).rejects.toThrow(/AIRI_QA_DISPLAY_SESSION is not set/)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('keeps the host-wide ps listing on macOS', async () => {
    vi.mocked(execFile).mockClear()
    await expect(listLiveProcesses(1_000, 'darwin', {})).rejects.toThrow(/host process listing spawned/)
    expect(vi.mocked(execFile).mock.calls[0]?.[0]).toBe('ps')
  })
})
