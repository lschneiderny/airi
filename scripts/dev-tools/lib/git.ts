import process from 'node:process'

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { capture } from './exec'

export function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return capture('git', args, { cwd, env })
}

export function repoRoot(cwd: string): string {
  return resolve(git(cwd, ['rev-parse', '--show-toplevel']))
}

/** The `.git` directory every worktree of this clone shares, so caches written there serve all of them. */
export function gitCommonDir(root: string): string {
  return resolve(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
}

export interface ChangedFile {
  path: string
  deleted: boolean
}

/** Files that differ between `base` and the working tree: committed, staged, unstaged, and untracked. */
export function changedFiles(root: string, base: string): ChangedFile[] {
  const files = new Map<string, ChangedFile>()
  const diff = git(root, ['diff', '--name-status', '--no-renames', '-z', base]).split('\0').filter(Boolean)
  for (let index = 0; index + 1 < diff.length; index += 2)
    files.set(diff[index + 1], { path: diff[index + 1], deleted: diff[index] === 'D' })
  for (const path of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))
    files.set(path, { path, deleted: false })
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Tree hash of the working tree as `git add -A` would stage it, without touching the real index.
 * A copy of the index keeps stat data, so Git rehashes only files that changed.
 */
export function workingTreeHash(root: string): string {
  const scratch = mkdtempSync(join(tmpdir(), 'airi-tree-'))
  try {
    const index = join(scratch, 'index')
    const realIndex = resolve(root, git(root, ['rev-parse', '--git-path', 'index']))
    if (existsSync(realIndex))
      copyFileSync(realIndex, index)
    const env = { ...process.env, GIT_INDEX_FILE: index }
    git(root, ['add', '-A'], env)
    return git(root, ['write-tree'], env)
  }
  finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

export interface Worktree {
  path: string
  head: string
  branch: string | null
  locked: boolean
  prunable: boolean
}

export function parseWorktreeList(porcelain: string): Worktree[] {
  return porcelain.split(/\r?\n\r?\n/).map(block => block.trim()).filter(Boolean).map((block) => {
    const fields = new Map<string, string>()
    for (const line of block.split(/\r?\n/)) {
      const space = line.indexOf(' ')
      fields.set(space === -1 ? line : line.slice(0, space), space === -1 ? '' : line.slice(space + 1))
    }
    const branch = fields.get('branch')
    return {
      path: resolve(fields.get('worktree') ?? ''),
      head: fields.get('HEAD') ?? '',
      branch: branch ? branch.replace(/^refs\/heads\//, '') : null,
      locked: fields.has('locked'),
      prunable: fields.has('prunable'),
    }
  })
}

export function listWorktrees(root: string): Worktree[] {
  return parseWorktreeList(git(root, ['worktree', 'list', '--porcelain']))
}
