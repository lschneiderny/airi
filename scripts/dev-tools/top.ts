import type { AttributedProcess } from './lib/processes'

import process from 'node:process'

import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { readStatus } from '@proj-airi/cpu-slots'

import { cpuSlotsJson, readCpuSlots, renderCpuSlots } from './lib/cpu-slots'
import { listWorktrees, repoRoot } from './lib/git'
import { ancestry, attribute, descendants, isOrphan, normalizePath, rollup, snapshotProcesses } from './lib/processes'

const usage = `Usage: pnpm dev:top [--processes] [--json]
       pnpm dev:top kill <worktree-name> [--orphans] [--yes]

  --processes  list every attributed process, not only the per-worktree rollup
  --json       print the snapshot as JSON
  kill         stop the dev processes of one worktree (dry run unless --yes);
               --orphans limits it to processes whose parent has exited`

const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`.padStart(8)
const cores = (percent: number) => `${(percent / 100).toFixed(1)} cores`.padStart(11)

function label(worktree: string | null, names: Map<string, string>): string {
  return worktree === null ? '(outside any worktree)' : names.get(worktree) ?? worktree
}

function printRollup(processes: AttributedProcess[], names: Map<string, string>, listAll: boolean): void {
  const groups = rollup(processes)
  const total = groups.reduce((sum, group) => ({ memoryMb: sum.memoryMb + group.memoryMb, cpuPercent: sum.cpuPercent + group.cpuPercent }), { memoryMb: 0, cpuPercent: 0 })
  console.info(`dev processes: ${gb(total.memoryMb).trim()} memory, ${cores(total.cpuPercent).trim()} busy`)
  for (const group of groups) {
    const orphans = group.orphans ? `, ${group.orphans} orphaned` : ''
    console.info(`\n${label(group.worktree, names)}  ${group.count} process(es)${orphans}`)
    console.info(`  ${gb(group.memoryMb)} ${cores(group.cpuPercent)}  total`)
    for (const tool of group.tools)
      console.info(`  ${gb(tool.memoryMb)} ${cores(tool.cpuPercent)}  ${tool.tool} x${tool.count}`)
    if (!listAll)
      continue
    for (const info of processes.filter(item => item.worktree === group.worktree).sort((a, b) => b.memoryMb - a.memoryMb))
      console.info(`    pid ${String(info.pid).padStart(6)} ${String(info.memoryMb).padStart(6)} MB ${isOrphan(info) ? 'ORPHAN ' : ''}${info.command.slice(0, 160)}`)
  }
}

/** Re-reads the live command line right before a kill, because Windows reuses PIDs quickly. */
function stillMatches(pid: number, worktree: string): boolean {
  try {
    const command = process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8' })
      : execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' })
    return normalizePath(command).includes(worktree)
  }
  catch {
    // The process exited between the snapshot and the check.
    return false
  }
}

function killTree(pid: number, processes: AttributedProcess[]): void {
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  // POSIX has no tree kill, and the top member is often not a process-group leader (pnpm or turbo started it),
  // so a group kill could miss it or hit its launcher. Signal each descendant from the snapshot instead.
  for (const member of descendants(processes, pid)) {
    try {
      process.kill(member, 'SIGKILL')
    }
    catch (error) {
      // A descendant that exited after the snapshot is already stopped.
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ESRCH')
        throw error
    }
  }
}

function kill(processes: AttributedProcess[], names: Map<string, string>, target: string, orphansOnly: boolean, confirmed: boolean): number {
  const worktree = [...names.entries()].find(([, name]) => name === target)?.[0]
  if (!worktree) {
    console.error(`No worktree named ${JSON.stringify(target)}. Known: ${[...names.values()].join(', ')}`)
    return 2
  }
  const self = ancestry(processes, process.pid)
  const members = processes.filter(info => info.worktree === worktree && !self.has(info.pid) && (orphansOnly ? isOrphan(info) : /^(?:node|electron|godot\w*|esbuild)(?:\.exe)?$/i.test(info.name)))
  const memberPids = new Set(members.map(info => info.pid))
  // Kill each tree once, from its top-most member; killTree takes the descendants with it.
  const roots = members.filter(info => !memberPids.has(info.ppid))
  if (!roots.length) {
    console.info(`Nothing to stop in ${target}.`)
    return 0
  }
  for (const info of roots) {
    const line = `pid ${info.pid} ${info.tool} ${info.command.slice(0, 140)}`
    if (!confirmed) {
      console.info(`would stop ${line}`)
      continue
    }
    if (!stillMatches(info.pid, worktree)) {
      console.info(`skipped ${line} (no longer this worktree's process)`)
      continue
    }
    try {
      killTree(info.pid, processes)
      console.info(`stopped ${line}`)
    }
    catch (error) {
      console.error(`could not stop pid ${info.pid}: ${errorMessageFrom(error) ?? 'unknown error'}`)
    }
  }
  if (!confirmed)
    console.info('\nDry run. Add --yes to stop these process trees.')
  return 0
}

function main(argv: string[]): number {
  const root = repoRoot(process.cwd())
  const worktrees = listWorktrees(root)
  const names = new Map(worktrees.map(worktree => [normalizePath(worktree.path), basename(worktree.path)]))
  const processes = attribute(snapshotProcesses(), worktrees.map(worktree => worktree.path))
  if (argv[0] === 'kill') {
    const target = argv[1]
    if (!target) {
      console.error(usage)
      return 2
    }
    return kill(processes, names, target, argv.includes('--orphans'), argv.includes('--yes'))
  }
  const unknown = argv.filter(arg => arg !== '--json' && arg !== '--processes')
  if (unknown.length) {
    console.error(`Unknown argument ${JSON.stringify(unknown[0])}\n${usage}`)
    return 2
  }
  const cpuSlots = readCpuSlots(() => readStatus())
  if (argv.includes('--json')) {
    console.info(JSON.stringify({ worktrees: rollup(processes).map(group => ({ ...group, name: label(group.worktree, names) })), processes: processes.filter(info => info.worktree !== null), cpuSlots: cpuSlotsJson(cpuSlots) }, null, 2))
    return 0
  }
  for (const line of renderCpuSlots(cpuSlots))
    console.info(line)
  console.info('')
  printRollup(processes, names, argv.includes('--processes'))
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
}
catch (error) {
  console.error(`dev:top broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  process.exitCode = 1
}
