import type { ProcessSnapshot } from './processes'

import process from 'node:process'

import { processStartedAt } from './processes'

export interface ProcessIdentity {
  pid: number
  startedAt: number
}

export interface WorkloadOwner extends ProcessIdentity {
  createdAt: number
  workload: ProcessIdentity[]
}

export function isAlive(pid: number, kill: (pid: number, signal: 0) => unknown = process.kill): boolean {
  try {
    kill(pid, 0)
    return true
  }
  catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'ESRCH')
        return false
      if (error.code === 'EPERM')
        return true
    }
    throw error
  }
}

export function isSameProcess(pid: number, startedAt: number, lookup = processStartedAt): boolean {
  const actual = lookup(pid)
  return actual !== undefined && Math.abs(actual - startedAt) <= 2_000
}

/**
 * Recorded PIDs remain ancestry anchors after exit. On POSIX only the original
 * process group survives reparenting; a grandchild that calls setsid is untracked.
 */
export function workloadAlive(lease: WorkloadOwner, snapshot: ProcessSnapshot): boolean {
  const byPid = new Map(snapshot.processes.map(info => [info.pid, info]))
  if (lease.workload.some(({ pid, startedAt }) => {
    const info = byPid.get(pid)
    return info !== undefined && Math.abs(info.startedAt - startedAt) <= 2_000
  })) {
    return true
  }

  const roots = new Set([lease.pid, ...lease.workload.map(info => info.pid)])
  return snapshot.processes.some((info) => {
    if (info.pid === lease.pid || info.startedAt < lease.createdAt)
      return false
    if (snapshot.platform !== 'win32' && lease.workload.some(work => work.pid === info.pgid))
      return true
    const visited = new Set<number>([info.pid])
    let parent = info.ppid
    while (parent > 0 && !visited.has(parent)) {
      if (roots.has(parent))
        return true
      visited.add(parent)
      parent = byPid.get(parent)?.ppid ?? 0
    }
    return false
  })
}
