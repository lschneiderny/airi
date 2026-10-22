import type { ProcessSnapshot } from './processes'

import process from 'node:process'

import { liveParent, processStartedAt } from './processes'

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

function sameStart(a: ProcessIdentity, b: ProcessIdentity): boolean {
  return Math.abs(a.startedAt - b.startedAt) <= 2_000
}

/**
 * Recorded PIDs remain ancestry anchors after exit. Windows keeps a dead parent's
 * pid in ParentProcessId and reuses pids, so every link must lead to a process
 * created no later than its child: a process that names a root pid counts only
 * if that pid's current holder is the root itself, is gone, or was created after
 * the child. On POSIX only the original process group survives reparenting; a
 * grandchild that calls setsid is untracked.
 */
export function workloadAlive(lease: WorkloadOwner, snapshot: ProcessSnapshot): boolean {
  const byPid = new Map(snapshot.processes.map(info => [info.pid, info]))
  if (lease.workload.some((work) => {
    const info = byPid.get(work.pid)
    return info !== undefined && sameStart(info, work)
  })) {
    return true
  }

  const roots = new Map<number, ProcessIdentity>([[lease.pid, lease], ...lease.workload.map(work => [work.pid, work] as const)])
  const createdByRoot = (child: ProcessIdentity, pid: number | undefined): boolean => {
    const root = pid === undefined ? undefined : roots.get(pid)
    if (!root)
      return false
    const holder = byPid.get(root.pid)
    return !holder || holder.startedAt > child.startedAt || sameStart(holder, root)
  }
  // `ps lstart` truncates to whole seconds, so a child created in the lease's
  // own second must not look older than the lease.
  const since = snapshot.platform === 'win32' ? lease.createdAt : Math.floor(lease.createdAt / 1_000) * 1_000
  return snapshot.processes.some((info) => {
    if (info.startedAt < since || (info.pid === lease.pid && sameStart(info, lease)))
      return false
    if (snapshot.platform !== 'win32' && lease.workload.some(work => work.pid === info.pgid) && createdByRoot(info, info.pgid))
      return true
    const visited = new Set<ProcessIdentity>()
    let current: typeof info | undefined = info
    while (current && !visited.has(current)) {
      if (createdByRoot(current, current.ppid))
        return true
      visited.add(current)
      current = liveParent(current, byPid)
    }
    return false
  })
}
