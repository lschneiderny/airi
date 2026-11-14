import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readWorktreeState } from './worktree'

describe('readWorktreeState', () => {
  let repo: string
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=qa', '-c', 'user.email=qa@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' }).trim()

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'qa-perf-worktree-'))
    git('init', '--quiet')
    writeFileSync(join(repo, 'tracked.txt'), 'one\n')
    git('add', 'tracked.txt')
    git('commit', '--quiet', '-m', 'init')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('is the HEAD sha without a diff hash for a clean tree', async () => {
    expect(await readWorktreeState(repo)).toEqual({ sha: git('rev-parse', 'HEAD'), diffHash: null })
  })

  it('hashes tracked changes and untracked file contents, from any directory of the repository', async () => {
    writeFileSync(join(repo, 'tracked.txt'), 'two\n')
    const trackedOnly = await readWorktreeState(repo)
    mkdirSync(join(repo, 'sub'))
    writeFileSync(join(repo, 'sub', 'new.txt'), 'a\n')
    const withUntracked = await readWorktreeState(join(repo, 'sub'))
    writeFileSync(join(repo, 'sub', 'new.txt'), 'b\n')
    const untrackedEdited = await readWorktreeState(repo)

    expect(trackedOnly.sha).toBe(git('rev-parse', 'HEAD'))
    expect(trackedOnly.diffHash).toMatch(/^[0-9a-f]{64}$/)
    expect(new Set([trackedOnly.diffHash, withUntracked.diffHash, untrackedEdited.diffHash]).size).toBe(3)
    expect(await readWorktreeState(repo)).toEqual(untrackedEdited)
  })
})
