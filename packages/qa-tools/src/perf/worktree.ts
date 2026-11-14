import type { BenchCodeState } from './bench'

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'

const run = promisify(execFile)
/** `git diff HEAD` of a large change exceeds the 1 MiB `execFile` default. */
const MAX_BUFFER = 64 * 1024 * 1024
const HASH_OBJECT_BATCH = 100

/**
 * The checkout's code state as the desktop recorder's `PerfIdentity` hashes it
 * (`apps/stage-tamagotchi/src/main/services/airi/perf-recording/identity.ts`), so `worktree` finds the runs that
 * `qa:bench` recorded from this tree: the HEAD sha, and for a dirty tree the sha256 of `git diff HEAD` followed by
 * the name and blob hash of every untracked file, sorted by name. Keep both in step; a drift makes `worktree`
 * report no runs, never a wrong comparison. Throws when git cannot answer.
 */
export async function readWorktreeState(cwd: string): Promise<BenchCodeState> {
  const git = async (root: string, ...args: string[]) => (await run('git', ['--no-optional-locks', ...args], { cwd: root, maxBuffer: MAX_BUFFER, encoding: 'utf8' })).stdout
  // Untracked names and `hash-object` paths are relative to the working directory, so run at the top level.
  const root = (await git(cwd, 'rev-parse', '--show-toplevel')).trim()
  const [head, porcelain, diff, untrackedList] = await Promise.all([
    git(root, 'rev-parse', 'HEAD'),
    git(root, 'status', '--porcelain', '--untracked-files=normal'),
    git(root, 'diff', 'HEAD'),
    git(root, 'ls-files', '--others', '--exclude-standard', '-z'),
  ])
  const sha = head.trim()
  if (porcelain.trim() === '')
    return { sha, diffHash: null }
  const hash = createHash('sha256').update(diff)
  const untracked = untrackedList.split('\0').filter(name => name !== '').sort()
  for (let start = 0; start < untracked.length; start += HASH_OBJECT_BATCH) {
    const names = untracked.slice(start, start + HASH_OBJECT_BATCH)
    const blobs = (await git(root, 'hash-object', '--no-filters', '--', ...names)).split('\n').filter(line => line !== '')
    if (blobs.length !== names.length)
      throw new Error('git hash-object returned an unexpected line count')
    names.forEach((name, index) => hash.update('\0').update(name).update('\0').update(blobs[index]))
  }
  return { sha, diffHash: hash.digest('hex') }
}
