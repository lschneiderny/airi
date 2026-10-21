import type { LiveProcess } from './processes'

import { describe, expect, it } from 'vitest'

import { commandLineContainsPath, descendantsOf, killOwnedTree, parsePosixProcessListing, parseWindowsProcessListing, treeKillCommand } from './processes'

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
