import type { ProcessInfo } from './processes'

import { describe, expect, it } from 'vitest'

import { ancestry, attribute, classifyTool, cpuPercentFromRaw, isOrphan, normalizePath, rollup } from './processes'

const proc = (pid: number, ppid: number, name: string, command: string, memoryMb = 100, cpuPercent = 0): ProcessInfo => ({ pid, ppid, name, command, memoryMb, cpuPercent, startedAt: null })

const main = 'C:\\Users\\Luke\\projects\\dtuber'
const t13 = 'C:\\Users\\Luke\\projects\\dtuber-wt\\qa-tooling-t13'

describe('normalizePath', () => {
  it('makes Windows, POSIX, and file-URL spellings comparable', () => {
    expect(normalizePath('C:\\Users\\Luke\\X\\')).toBe('c:/users/luke/x')
    expect(normalizePath('file:///C:/Users/Luke/X')).toBe('c:/users/luke/x')
  })
})

describe('classifyTool', () => {
  it('names the tool behind a node process', () => {
    expect(classifyTool({ name: 'node.exe', command: `node ${t13}\\node_modules\\vitest\\vitest.mjs run` })).toBe('vitest')
    expect(classifyTool({ name: 'node.exe', command: 'node "x\\vue-tsc\\bin\\vue-tsc.js" --noEmit' })).toBe('vue-tsc')
    expect(classifyTool({ name: 'node.exe', command: 'node C:/pnpm/bin/pnpm.mjs install --frozen-lockfile' })).toBe('pnpm install')
    expect(classifyTool({ name: 'node.exe', command: 'node C:/pnpm/bin/pnpm.mjs -F @proj-airi/qa-tools run motion gate' })).toBe('qa-tools')
  })

  it('does not mistake an install-named test file for pnpm install', () => {
    expect(classifyTool({ name: 'node.exe', command: 'node C:/pnpm/bin/pnpm.mjs exec vitest run install.test.ts' })).toBe('vitest')
  })
})

describe('attribute', () => {
  const processes = [
    proc(1, 0, 'omo.exe', 'C:\\Users\\Luke\\.local\\bin\\omo.exe'),
    proc(10, 1, 'powershell.exe', 'powershell -Command "Set-Location dtuber-wt/qa-tooling-t13"'),
    proc(11, 10, 'node.exe', `node --import file:///${main.replaceAll('\\', '/')}/node_modules/tsx/dist/loader.mjs ${t13}\\packages\\qa-tools\\bin\\motion.ts`, 300, 50),
    proc(12, 11, 'node.exe', `node ${t13}\\node_modules\\vitest\\vitest.mjs run`, 250, 400),
    proc(13, 12, 'conhost.exe', '\\??\\C:\\WINDOWS\\system32\\conhost.exe'),
    proc(20, 999, 'node.exe', `node ${main}\\node_modules\\vitest\\vitest.mjs run`, 200, 0),
  ]
  const result = attribute(processes, [main, t13])
  const byPid = new Map(result.map(info => [info.pid, info]))

  it('prefers the longest worktree path and stops at path boundaries', () => {
    expect(byPid.get(11)?.worktree).toBe(normalizePath(t13))
    expect(byPid.get(20)?.worktree).toBe(normalizePath(main))
  })

  it('inherits the worktree of the nearest attributed ancestor', () => {
    expect(byPid.get(13)?.worktree).toBe(normalizePath(t13))
    expect(byPid.get(10)?.worktree).toBeNull()
  })

  it('flags a dev runtime whose parent is gone as orphaned', () => {
    expect(isOrphan(byPid.get(20)!)).toBe(true)
    expect(isOrphan(byPid.get(12)!)).toBe(false)
  })

  it('rolls memory and CPU up per worktree and tool', () => {
    const t13Group = rollup(result).find(group => group.worktree === normalizePath(t13))
    expect(t13Group?.memoryMb).toBe(650)
    expect(t13Group?.cpuPercent).toBe(450)
    expect(t13Group?.tools.map(tool => tool.tool)).toEqual(['qa-tools', 'vitest', 'conhost'])
    expect(rollup(result).find(group => group.worktree === normalizePath(main))?.orphans).toBe(1)
  })
})

describe('ancestry', () => {
  it('returns the process and its live ancestors, and survives a parent cycle', () => {
    expect(ancestry([proc(1, 0, 'a', ''), proc(2, 1, 'b', ''), proc(3, 2, 'c', '')], 3)).toEqual(new Set([3, 2, 1]))
    expect(ancestry([proc(1, 2, 'a', ''), proc(2, 1, 'b', '')], 1)).toEqual(new Set([1, 2]))
  })
})

describe('cpuPercentFromRaw', () => {
  const sec = 10_000_000
  it('turns raw 100 ns deltas into percent of one core', () => {
    const first = [{ i: 0, c: 0, t: 100 }, { i: 10, c: 5 * sec, t: 1000 * sec }, { i: 11, c: 0, t: 1000 * sec }, { i: 12, c: 0, t: 1000 * sec }]
    const second = [{ i: 0, c: 99 * sec, t: 1001 * sec }, { i: 10, c: 9 * sec, t: 1001 * sec }, { i: 11, c: 0.5 * sec, t: 1002 * sec }, { i: 13, c: sec, t: 1001 * sec }]
    const result = cpuPercentFromRaw(first, second)
    expect(result.get(10)).toBeCloseTo(400)
    expect(result.get(11)).toBeCloseTo(25)
  })

  it('drops PID 0, processes seen once, and counters that went backwards', () => {
    const result = cpuPercentFromRaw(
      [{ i: 0, c: 0, t: 0 }, { i: 20, c: 100, t: 0 }, { i: 21, c: 5, t: 10 }],
      [{ i: 0, c: 50, t: 10 }, { i: 20, c: 50, t: 10 }, { i: 21, c: 5, t: 10 }, { i: 22, c: 5, t: 10 }],
    )
    expect([...result.keys()]).toEqual([])
  })
})
