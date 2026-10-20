import type { KillReceipt, LiveProcess, OwnedProcess, ProcessLister, TreeKiller } from '../env/processes'

import { errorMessageFrom } from '@moeru/std'

import { commandLineContainsPath, descendantsOf, isSameProcess, killOwnedTree } from '../env/processes'

/** What a run owns: the root it launched, every process seen in its tree, and the paths that mark its processes. */
export interface RunOwnership {
  repoRoot: string
  profileDir: string
  root?: OwnedProcess
  tracked: readonly OwnedProcess[]
  /** This CLI and its parent; never counted or killed. */
  selfPids: readonly number[]
}

const appFamilyPattern = /electron|stage-tamagotchi/i

/**
 * The live processes that belong to the run: anything recorded in its tree (same PID and creation time), anything whose
 * command line contains the run's profile directory, and any Electron or stage-tamagotchi process of this worktree.
 * Processes of other worktrees never match, because the worktree path must match as a whole path.
 */
export function findRunProcesses(listing: readonly LiveProcess[], ownership: RunOwnership): LiveProcess[] {
  const known = ownership.root ? [ownership.root, ...ownership.tracked] : [...ownership.tracked]
  return listing.filter((entry) => {
    if (ownership.selfPids.includes(entry.pid))
      return false
    if (known.some(owned => isSameProcess(entry, owned) && owned.created !== undefined))
      return true
    if (commandLineContainsPath(entry.commandLine, ownership.profileDir))
      return true
    return commandLineContainsPath(entry.commandLine, ownership.repoRoot) && appFamilyPattern.test(entry.commandLine)
  })
}

/** Electron or stage-tamagotchi processes of this worktree; a rendered run refuses to start while any runs. */
export function findWorktreeAppProcesses(listing: readonly LiveProcess[], repoRoot: string, selfPids: readonly number[]): LiveProcess[] {
  return listing.filter(entry => !selfPids.includes(entry.pid) && commandLineContainsPath(entry.commandLine, repoRoot) && appFamilyPattern.test(entry.commandLine))
}

/** Records the current tree of the root, so processes that lose their parent link later are still known. */
export function trackTree(listing: readonly LiveProcess[], root: OwnedProcess): OwnedProcess[] {
  return descendantsOf(listing, root).map(entry => ({ pid: entry.pid, created: entry.created, commandLine: entry.commandLine }))
}

export interface TeardownDeps {
  list: ProcessLister
  kill: TreeKiller
  /** `Browser.close` over CDP; undefined when no CDP connection was made. */
  closeBrowser?: () => Promise<void>
  /** Resolves `true` when the root exits within the time. */
  waitRootExit?: (timeoutMs: number) => Promise<boolean>
  removeDir: (path: string) => void
  /** Bounded wait for observable state between process-table reads. */
  sleep: (ms: number) => Promise<void>
  /** Clock of those waits; defaults to `Date.now`. */
  now?: () => number
}

export interface TeardownReport {
  browserClose: { attempted: boolean, ok: boolean, detail: string }
  rootExitedAfterBrowserClose: boolean | null
  kills: KillReceipt[]
  refused: string[]
  leftovers: { pid: number, commandLine: string }[]
  profileRemoved: boolean
  removed: string[]
  ok: boolean
}

async function waitUntilGone(ownership: RunOwnership, deps: TeardownDeps, timeoutMs: number): Promise<LiveProcess[]> {
  const now = deps.now ?? Date.now
  const deadline = now() + timeoutMs
  let delay = 250
  for (;;) {
    const remaining = findRunProcesses(await deps.list(), ownership)
    if (remaining.length === 0 || now() >= deadline)
      return remaining
    await deps.sleep(Math.min(delay, Math.max(0, deadline - now())))
    delay = Math.min(2_000, delay * 2)
  }
}

/**
 * Tears a run down: `Browser.close` over CDP, then (only after a live ownership check) `taskkill /PID <root> /T /F`,
 * then every remaining run process individually, then a final listing. The profile and `extraPaths` are removed only
 * when no run process remains; otherwise the report lists the leftovers and `ok` is false.
 */
export async function teardownRun(ownership: RunOwnership, deps: TeardownDeps, extraPaths: readonly string[] = []): Promise<TeardownReport> {
  const report: TeardownReport = {
    browserClose: { attempted: false, ok: false, detail: 'no CDP connection' },
    rootExitedAfterBrowserClose: null,
    kills: [],
    refused: [],
    leftovers: [],
    profileRemoved: false,
    removed: [],
    ok: false,
  }
  const ownedPaths = [ownership.repoRoot, ownership.profileDir]

  if (deps.closeBrowser) {
    report.browserClose.attempted = true
    try {
      await deps.closeBrowser()
      report.browserClose = { attempted: true, ok: true, detail: 'Browser.close sent' }
    }
    catch (error) {
      report.browserClose = { attempted: true, ok: false, detail: errorMessageFrom(error) ?? 'Browser.close failed' }
    }
  }
  if (deps.waitRootExit)
    report.rootExitedAfterBrowserClose = await deps.waitRootExit(10_000)

  // Re-read the table: the tree may have changed since the run last looked.
  const before = await deps.list()
  const extended: RunOwnership = ownership.root
    ? { ...ownership, tracked: [...ownership.tracked, ...trackTree(before, ownership.root)] }
    : ownership

  const killOne = async (target: OwnedProcess) => {
    try {
      const receipt = await killOwnedTree(target, { ownedPaths }, deps)
      if (receipt)
        report.kills.push(receipt)
    }
    catch (error) {
      report.refused.push(errorMessageFrom(error) ?? `refused PID ${target.pid}`)
    }
  }

  if (extended.root)
    await killOne(extended.root)
  let remaining = await waitUntilGone(extended, deps, 15_000)
  for (const entry of remaining)
    await killOne(entry)
  if (remaining.length > 0)
    remaining = await waitUntilGone(extended, deps, 15_000)

  report.leftovers = remaining.map(entry => ({ pid: entry.pid, commandLine: entry.commandLine }))
  if (report.leftovers.length === 0) {
    for (const path of [ownership.profileDir, ...extraPaths]) {
      try {
        deps.removeDir(path)
        report.removed.push(path)
      }
      catch (error) {
        report.refused.push(`could not remove ${path}: ${errorMessageFrom(error) ?? 'unknown error'}`)
      }
    }
    report.profileRemoved = report.removed.includes(ownership.profileDir)
  }
  report.ok = report.leftovers.length === 0 && report.profileRemoved && report.refused.length === 0
  return report
}
