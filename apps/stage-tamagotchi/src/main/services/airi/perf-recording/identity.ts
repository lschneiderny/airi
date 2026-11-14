import type { IdentityRecord } from '@proj-airi/stage-shared/perf/usage'

import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

/** What a perf session records about the running code, before the recorder stamps an epoch on it. */
export type PerfIdentityValue = Pick<IdentityRecord, 'sha' | 'shortSha' | 'branch' | 'dirty' | 'diffHash' | 'source'>

/** The `~build/git` values baked in at build time. */
export interface PerfBuildInfo {
  sha: string
  abbreviatedSha: string
  branch: string
}

/**
 * Runs one command and resolves with its stdout. Rejects on a non-zero exit, a spawn error or `timeoutMs`.
 *
 * The implementation must allow large stdout: a valid `git diff HEAD` can exceed Node's 1 MiB `execFile`
 * default, so the recorder sets `maxBuffer` (for example 64 MiB). An overflow rejects, and the identity
 * then falls back to build info with `dirty: null`.
 */
export type PerfExec = (
  command: string,
  args: readonly string[],
  options: { cwd: string, timeoutMs: number },
) => Promise<string>

export interface PerfIdentityOptions {
  /** `import.meta.env.DEV`. Only a development build reads git at runtime. */
  dev: boolean
  /** `app.getAppPath()`; the walk up to a `.git` entry starts here. */
  appPath: string
  buildInfo: PerfBuildInfo
  exec: PerfExec
  /** Whether a file or directory exists. A `pnpm wt` worktree has a `.git` file, the main checkout a directory. */
  pathExists: (path: string) => Promise<boolean>
}

const GIT_TIMEOUT_MS = 5_000
const SHORT_SHA_LENGTH = 7
const HASH_OBJECT_BATCH = 100
const FULL_SHA = /^[0-9a-f]{40}$/

/** Whether the running code changed between two reads. Branch is ignored, since a rename does not change the code. */
export function perfIdentityChanged(previous: PerfIdentityValue, next: PerfIdentityValue): boolean {
  return previous.sha !== next.sha || previous.dirty !== next.dirty || previous.diffHash !== next.diffHash
}

/**
 * Reads the identity again and returns it when the running code changed since `current`, else `null`.
 *
 * A read that differs is confirmed by a second read, and a switch from runtime git to build info is never a change:
 * in a development build it only means that one git read failed, for example when an untracked file disappeared
 * between `ls-files` and `hash-object`.
 */
export async function readIdentityChange(identity: Pick<PerfIdentity, 'read'>, current: PerfIdentityValue): Promise<PerfIdentityValue | null> {
  const isGitFailure = (value: PerfIdentityValue) => current.source === 'runtime-git' && value.source === 'build-info'
  let next = await identity.read()
  if (isGitFailure(next) || perfIdentityChanged(current, next))
    next = await identity.read()
  return !isGitFailure(next) && perfIdentityChanged(current, next) ? next : null
}

/**
 * Reads which code is running: git at runtime in a development build, build info everywhere else, and
 * as the fallback when git cannot answer. It never throws and never stores diff content, file names or
 * file contents: the diff plus the name and blob hash of every untracked file go into one sha256, and
 * only that hash is kept.
 */
export class PerfIdentity {
  constructor(private readonly options: PerfIdentityOptions) {}

  async read(): Promise<PerfIdentityValue> {
    if (!this.options.dev)
      return this.fromBuildInfo()

    try {
      const root = await this.findRepositoryRoot()
      return root === null ? this.fromBuildInfo() : await this.fromGit(root)
    }
    catch {
      return this.fromBuildInfo()
    }
  }

  private fromBuildInfo(): PerfIdentityValue {
    const { sha, abbreviatedSha, branch } = this.options.buildInfo
    return { sha, shortSha: abbreviatedSha, branch, dirty: null, diffHash: null, source: 'build-info' }
  }

  private async findRepositoryRoot(): Promise<string | null> {
    let directory = this.options.appPath
    while (true) {
      if (await this.options.pathExists(join(directory, '.git')))
        return directory
      const parent = dirname(directory)
      if (parent === directory)
        return null
      directory = parent
    }
  }

  private async fromGit(cwd: string): Promise<PerfIdentityValue> {
    // `--no-optional-locks` keeps these read-only calls from taking the index lock the user's own git needs.
    const git = (...args: string[]) => this.options.exec('git', ['--no-optional-locks', ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS })
    const [head, branch, porcelain, diff, untrackedList] = await Promise.all([
      git('rev-parse', 'HEAD'),
      git('rev-parse', '--abbrev-ref', 'HEAD'),
      git('status', '--porcelain', '--untracked-files=normal'),
      git('diff', 'HEAD'),
      git('ls-files', '--others', '--exclude-standard', '-z'),
    ])

    const sha = head.trim()
    const branchName = branch.trim()
    if (!FULL_SHA.test(sha) || branchName === '')
      throw new Error('git returned an unusable HEAD')

    const dirty = porcelain.trim() !== ''
    const untracked = untrackedList.split('\0').filter(name => name !== '').sort()
    return {
      sha,
      shortSha: sha.slice(0, SHORT_SHA_LENGTH),
      // A detached HEAD reports the literal `HEAD`, which names no branch.
      branch: branchName === 'HEAD' ? null : branchName,
      dirty,
      diffHash: dirty ? await this.hashChanges(git, diff, untracked) : null,
      source: 'runtime-git',
    }
  }

  private async hashChanges(git: (...args: string[]) => Promise<string>, diff: string, untracked: string[]): Promise<string> {
    const hash = createHash('sha256').update(diff)
    for (let start = 0; start < untracked.length; start += HASH_OBJECT_BATCH) {
      const names = untracked.slice(start, start + HASH_OBJECT_BATCH)
      const blobs = (await git('hash-object', '--no-filters', '--', ...names)).split('\n').filter(line => line !== '')
      if (blobs.length !== names.length)
        throw new Error('git hash-object returned an unexpected line count')
      names.forEach((name, index) => hash.update('\0').update(name).update('\0').update(blobs[index] ?? ''))
    }
    return hash.digest('hex')
  }
}
