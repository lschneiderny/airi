import process from 'node:process'

import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveWindowRectsPaths, windowRectsRepoRoot } from './measure'

const startCwd = process.cwd()

afterEach(() => {
  process.chdir(startCwd)
})

describe('window-rects output paths', () => {
  it('finds the repository root from the file location', () => {
    expect(existsSync(join(windowRectsRepoRoot, 'pnpm-workspace.yaml'))).toBe(true)
  })

  it('resolves defaults and relative values against the repo root whatever the working directory', () => {
    const expected = {
      outDir: join(windowRectsRepoRoot, 'packages', 'qa-tools', 'fixtures', 'window-rects'),
      rawDir: join(windowRectsRepoRoot, '.omo', 'evidence', 'mmd-actions-library'),
      out: join(windowRectsRepoRoot, 'x', 'dip.json'),
    }
    for (const cwd of [startCwd, join(windowRectsRepoRoot, 'packages', 'qa-tools'), tmpdir()]) {
      process.chdir(cwd)
      expect(resolveWindowRectsPaths(windowRectsRepoRoot, { out: 'x/dip.json' })).toEqual(expected)
    }
  })

  it('keeps absolute values as given', () => {
    const abs = resolve(tmpdir(), 'abs-out')
    expect(resolveWindowRectsPaths(windowRectsRepoRoot, { 'out-dir': abs }).outDir).toBe(abs)
  })
})
