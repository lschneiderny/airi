export interface WorktreeState {
  name: string
  path: string
  branch: string | null
  main: boolean
  locked: boolean
  /** Git reports the directory as gone. */
  prunable: boolean
  dirtyFiles: number
  /** HEAD is an ancestor of the main branch, so removing the worktree loses no commit. */
  merged: boolean
  lastCommitAt: number | null
  liveProcesses: number
}

const dayMs = 24 * 60 * 60 * 1000

/**
 * Why `gc` may remove this worktree, or why it must not. Removal deletes only the directory:
 * a branch keeps its commits, so an idle clean branch is safe to drop, while a detached HEAD that
 * main does not contain would lose its commits and is never a candidate.
 */
export function gcDecision(state: WorktreeState, idleDays: number, now: number): { remove: true, reason: string } | { remove: false, reason: string } {
  if (state.main)
    return { remove: false, reason: 'main worktree' }
  if (state.locked)
    return { remove: false, reason: 'locked' }
  if (state.prunable)
    return { remove: true, reason: 'directory already gone' }
  if (state.liveProcesses)
    return { remove: false, reason: `${state.liveProcesses} live process(es)` }
  if (state.dirtyFiles)
    return { remove: false, reason: `${state.dirtyFiles} uncommitted file(s)` }
  if (state.merged)
    return { remove: true, reason: state.branch ? 'merged into main' : 'detached at a main commit' }
  if (!state.branch)
    return { remove: false, reason: 'detached with commits main does not contain' }
  const idle = state.lastCommitAt === null ? Number.POSITIVE_INFINITY : (now - state.lastCommitAt) / dayMs
  if (idle >= idleDays)
    return { remove: true, reason: `no commit for ${Math.floor(idle)} days; branch ${state.branch} keeps its commits` }
  return { remove: false, reason: `active (last commit ${Math.floor(idle)} day(s) ago)` }
}

/** Why `rm` must refuse, or `null`. `--force` overrides only uncommitted files, never processes or unmerged detached commits. */
export function rmBlocker(state: WorktreeState, force: boolean): string | null {
  if (state.main)
    return 'refusing to remove the main worktree'
  if (state.liveProcesses)
    return `${state.liveProcesses} live process(es) still run from it; stop them with \`pnpm dev:top kill ${state.name}\``
  if (state.dirtyFiles && !force)
    return `${state.dirtyFiles} uncommitted file(s); commit them or pass --force`
  if (!state.branch && !state.merged && !state.prunable)
    return 'detached HEAD holds commits main does not contain; create a branch first'
  return null
}

const namePattern = /^[a-z0-9][\w.-]*$/i

export function validName(name: string): boolean {
  return namePattern.test(name)
}

export function defaultBranch(prefix: string, name: string): string {
  return `${prefix}/feat/${name}`
}
