import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseWorktreeList } from './git'

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
