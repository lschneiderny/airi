import type { KillReceipt, LiveProcess } from '../env/processes'
import type { RunOwnership } from './teardown'

import { describe, expect, it } from 'vitest'

import { findRunProcesses, findWorktreeAppProcesses, teardownRun } from './teardown'

const repoRoot = 'C:/wt/qa-tooling-t11'
const profileDir = 'C:/wt/qa-tooling-t11/.temp/qa/run-1/profile'

const root: LiveProcess = { pid: 100, parentPid: 1, created: 1000, commandLine: 'node pnpm.mjs --dir C:\\wt\\qa-tooling-t11 -F @proj-airi/stage-tamagotchi dev' }
const vite: LiveProcess = { pid: 101, parentPid: 100, created: 1001, commandLine: 'node C:\\wt\\qa-tooling-t11\\node_modules\\electron-vite\\bin\\electron-vite.js dev' }
const electron: LiveProcess = { pid: 102, parentPid: 101, created: 1002, commandLine: 'C:\\wt\\qa-tooling-t11\\node_modules\\electron\\dist\\electron.exe .' }
const renderer: LiveProcess = { pid: 103, parentPid: 102, created: 1003, commandLine: 'electron.exe --type=renderer --user-data-dir=C:\\wt\\qa-tooling-t11\\.temp\\qa\\run-1\\profile' }
const esbuild: LiveProcess = { pid: 104, parentPid: 101, created: 1004, commandLine: 'C:\\wt\\qa-tooling-t11\\node_modules\\@esbuild\\esbuild.exe --service' }
const self: LiveProcess = { pid: 7, parentPid: 6, created: 10, commandLine: 'node C:\\wt\\qa-tooling-t11\\node_modules\\tsx\\cli.mjs bin/motion.ts t3 --rig electron-ish' }
const foreignElectron: LiveProcess = { pid: 200, parentPid: 1, created: 900, commandLine: 'C:\\wt\\situational-presence\\node_modules\\electron\\dist\\electron.exe .' }
const foreignGodot: LiveProcess = { pid: 201, parentPid: 200, created: 901, commandLine: 'godot.exe --path C:\\wt\\situational-presence\\engines\\stage-tamagotchi-godot' }
const siblingWorktree: LiveProcess = { pid: 202, parentPid: 1, created: 902, commandLine: 'C:\\wt\\qa-tooling\\node_modules\\electron\\dist\\electron.exe .' }

const ownership: RunOwnership = { repoRoot, profileDir, root, tracked: [esbuild], selfPids: [7, 6] }

describe('findRunProcesses', () => {
  it('matches the tracked tree, the profile and this worktree\'s electron, never other worktrees or this CLI', () => {
    const found = findRunProcesses([root, vite, electron, renderer, esbuild, self, foreignElectron, foreignGodot, siblingWorktree], ownership)
    expect(found.map(entry => entry.pid)).toEqual([100, 101, 102, 103, 104])
  })

  it('does not treat a reused PID of a tracked process as the run\'s', () => {
    const reused: LiveProcess = { ...esbuild, created: 5000, commandLine: 'notepad.exe' }
    expect(findRunProcesses([reused], ownership)).toEqual([])
  })
})

describe('findWorktreeAppProcesses', () => {
  it('reports only this worktree\'s electron/stage-tamagotchi processes', () => {
    expect(findWorktreeAppProcesses([electron, foreignElectron, foreignGodot, siblingWorktree, self], repoRoot, [7]).map(entry => entry.pid)).toEqual([102])
  })
})

function fakeSystem(initial: LiveProcess[], options: { survivors?: number[] } = {}) {
  let listing = [...initial]
  let clock = 0
  const kills: number[] = []
  const removed: string[] = []
  return {
    kills,
    removed,
    deps: {
      list: async () => [...listing],
      kill: async (pid: number): Promise<Omit<KillReceipt, 'commandLine'>> => {
        kills.push(pid)
        const doomed = new Set<number>([pid])
        for (let grew = true; grew;) {
          grew = false
          for (const entry of listing) {
            if (!doomed.has(entry.pid) && doomed.has(entry.parentPid)) {
              doomed.add(entry.pid)
              grew = true
            }
          }
        }
        listing = listing.filter(entry => !doomed.has(entry.pid) || options.survivors?.includes(entry.pid))
        return { pid, invocation: `taskkill /PID ${pid} /T /F`, exitCode: 0, output: 'SUCCESS' }
      },
      removeDir: (path: string) => {
        removed.push(path)
      },
      sleep: async (ms: number) => {
        clock += ms
      },
      now: () => clock,
    },
  }
}

describe('teardownRun', () => {
  it('kills the root tree after Browser.close, leaves foreign processes alone, and removes the profile', async () => {
    const system = fakeSystem([root, vite, electron, renderer, esbuild, foreignElectron, foreignGodot, self])
    const closes: string[] = []
    const report = await teardownRun(ownership, { ...system.deps, closeBrowser: async () => {
      closes.push('Browser.close')
    }, waitRootExit: async () => false }, ['C:/wt/qa-tooling-t11/.temp/qa/run-1/rig.zip'])

    expect(closes).toEqual(['Browser.close'])
    expect(system.kills).toEqual([100])
    expect(report.leftovers).toEqual([])
    expect(report.ok).toBe(true)
    expect(system.removed).toEqual([profileDir, 'C:/wt/qa-tooling-t11/.temp/qa/run-1/rig.zip'])
    expect((await system.deps.list()).map(entry => entry.pid)).toEqual([200, 201, 7])
  })

  it('kills an orphan that lost its parent link individually', async () => {
    const orphan: LiveProcess = { ...renderer, parentPid: 999 }
    const system = fakeSystem([root, vite, orphan])
    const report = await teardownRun(ownership, system.deps)

    expect(system.kills).toEqual([100, 103])
    expect(report.ok).toBe(true)
  })

  it('reports leftovers and keeps the profile when a process survives', async () => {
    const system = fakeSystem([root, electron], { survivors: [102] })
    const report = await teardownRun({ ...ownership, tracked: [] }, system.deps)

    expect(report.ok).toBe(false)
    expect(report.leftovers.map(entry => entry.pid)).toEqual([102])
    expect(system.removed).toEqual([])
  })

  it('tears down without a root when the launch never happened', async () => {
    const system = fakeSystem([foreignElectron])
    const report = await teardownRun({ ...ownership, root: undefined, tracked: [] }, system.deps)

    expect(system.kills).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.browserClose).toEqual({ attempted: false, ok: false, detail: 'no CDP connection' })
  })
})
