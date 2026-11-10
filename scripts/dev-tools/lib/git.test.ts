import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { changedFiles, git, parseWorktreeList, workingTreeHash } from './git'

describe('changedFiles with a recorded working tree', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'verify-tree-'))
    git(root, ['init', '--initial-branch=main'])
    writeFileSync(join(root, 'tracked.ts'), 'export const value = 1\n')
    git(root, ['add', '.'])
    git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgSign=false', '-c', `core.hooksPath=${join(root, '.git/hooks')}`, 'commit', '-m', 'fixture'])
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('diffs a tree hash including staged, unstaged, deleted and untracked changes', () => {
    const base = workingTreeHash(root)
    rmSync(join(root, 'tracked.ts'))
    writeFileSync(join(root, 'staged.ts'), 'staged\n')
    git(root, ['add', 'staged.ts'])
    writeFileSync(join(root, 'staged.ts'), 'unstaged\n')
    writeFileSync(join(root, 'new.ts'), 'new\n')
    const index = readFileSync(join(root, '.git/index'))

    expect(changedFiles(root, base)).toEqual([
      { path: 'new.ts', deleted: false },
      { path: 'staged.ts', deleted: false },
      { path: 'tracked.ts', deleted: true },
    ])
    expect(readFileSync(join(root, '.git/index'))).toEqual(index)
  })

  it('does not repeat an unchanged untracked file already in the verified tree', () => {
    writeFileSync(join(root, 'untracked.ts'), 'already verified\n')
    const base = workingTreeHash(root)
    expect(changedFiles(root, base)).toEqual([])
    writeFileSync(join(root, 'untracked.ts'), 'changed after verify\n')
    expect(changedFiles(root, base)).toEqual([{ path: 'untracked.ts', deleted: false }])
  })
})

describe('parseWorktreeList', () => {
  it('reads branches, detached heads, and lock and prune markers', () => {
    const porcelain = [
      'worktree C:/repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree C:/repo-wt/verify',
      'HEAD 2222222222222222222222222222222222222222',
      'detached',
      'locked reason here',
      '',
      'worktree C:/repo-wt/gone',
      'HEAD 3333333333333333333333333333333333333333',
      'branch refs/heads/luke/feat/gone',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\r\n')
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: resolve('C:/repo'), head: '1111111111111111111111111111111111111111', branch: 'main', locked: false, prunable: false },
      { path: resolve('C:/repo-wt/verify'), head: '2222222222222222222222222222222222222222', branch: null, locked: true, prunable: false },
      { path: resolve('C:/repo-wt/gone'), head: '3333333333333333333333333333333333333333', branch: 'luke/feat/gone', locked: false, prunable: true },
    ])
  })
})
