import type { WorktreeState } from './wt-plan'

import { parseEnv } from 'node:util'

import { describe, expect, it } from 'vitest'

import { defaultBranch, envQaLine, gcDecision, qaModelSource, rmBlocker, tempWorktreeRefusal, validName } from './wt-plan'

const now = Date.UTC(2026, 9, 20)
function daysAgo(days: number): number {
  return now - days * 24 * 60 * 60 * 1000
}

function state(overrides: Partial<WorktreeState>): WorktreeState {
  return {
    name: 'feature',
    path: 'C:/repo-wt/feature',
    branch: 'luke/feat/feature',
    main: false,
    locked: false,
    prunable: false,
    dirtyFiles: 0,
    merged: false,
    lastCommitAt: daysAgo(1),
    liveProcesses: 0,
    ...overrides,
  }
}

describe('gcDecision', () => {
  it('never removes the main, locked, busy, or dirty worktree', () => {
    expect(gcDecision(state({ main: true, merged: true }), 14, now).remove).toBe(false)
    expect(gcDecision(state({ locked: true, merged: true }), 14, now).remove).toBe(false)
    expect(gcDecision(state({ liveProcesses: 2, merged: true }), 14, now)).toEqual({ remove: false, reason: '2 live process(es)' })
    expect(gcDecision(state({ dirtyFiles: 3, merged: true }), 14, now)).toEqual({ remove: false, reason: '3 uncommitted file(s)' })
  })

  it('removes merged, gone, and idle clean branch worktrees', () => {
    expect(gcDecision(state({ merged: true }), 14, now)).toEqual({ remove: true, reason: 'merged into main' })
    expect(gcDecision(state({ prunable: true, dirtyFiles: 0 }), 14, now).remove).toBe(true)
    expect(gcDecision(state({ lastCommitAt: daysAgo(20) }), 14, now)).toEqual({ remove: true, reason: 'no commit for 20 days; branch luke/feat/feature keeps its commits' })
  })

  it('keeps an active branch and a detached HEAD with commits main lacks', () => {
    expect(gcDecision(state({ lastCommitAt: daysAgo(3) }), 14, now).remove).toBe(false)
    expect(gcDecision(state({ branch: null, lastCommitAt: daysAgo(90) }), 14, now)).toEqual({ remove: false, reason: 'detached with commits main does not contain' })
    expect(gcDecision(state({ branch: null, merged: true }), 14, now)).toEqual({ remove: true, reason: 'detached at a main commit' })
  })
})

describe('rmBlocker', () => {
  it('lets --force override only uncommitted files', () => {
    expect(rmBlocker(state({ dirtyFiles: 2 }), false)).toMatch(/uncommitted/)
    expect(rmBlocker(state({ dirtyFiles: 2 }), true)).toBeNull()
    expect(rmBlocker(state({ liveProcesses: 1 }), true)).toMatch(/pnpm dev:top kill feature/)
    expect(rmBlocker(state({ branch: null }), true)).toMatch(/detached HEAD/)
    expect(rmBlocker(state({ main: true }), true)).toMatch(/main worktree/)
  })
})

describe('naming', () => {
  it('builds the default branch and rejects path-like names', () => {
    expect(defaultBranch('luke', 'dev-perf')).toBe('luke/feat/dev-perf')
    expect(validName('dev-perf')).toBe(true)
    expect(validName('../escape')).toBe(false)
    expect(validName('a/b')).toBe(false)
  })
})

describe('tempWorktreeRefusal', () => {
  it('refuses a path inside the temporary directory and allows a sibling with the same prefix', () => {
    expect(tempWorktreeRefusal('/tmp/repo-wt/probe', '/tmp')).toContain('inodes')
    expect(tempWorktreeRefusal('/tmpfs-repo-wt/probe', '/tmp')).toBeNull()
    expect(tempWorktreeRefusal('/mnt/dev/repo-wt/probe', '/tmp')).toBeNull()
  })
})

describe('qaModelSource', () => {
  it('prefers the environment, falls back to the source .env.qa, and names both when neither sets the model', () => {
    const file = '/repo/.env.qa'
    expect(qaModelSource({ AIRI_QA_MMD_MODEL: '/env.pmx' }, 'AIRI_QA_MMD_MODEL=/file.pmx\n', file)).toEqual({ model: '/env.pmx', from: 'the environment\'s AIRI_QA_MMD_MODEL' })
    expect(qaModelSource({}, 'AIRI_QA_MMD_MODEL=/file.pmx\n', file)).toEqual({ model: '/file.pmx', from: file })
    const missing = qaModelSource({}, undefined, file)
    expect('error' in missing && missing.error).toContain(file)
  })
})

describe('envQaLine', () => {
  it('writes a line that parseEnv reads back unchanged', () => {
    for (const model of ['/opt/random models/MMD/鸣潮_千咲1.02.pmx', 'C:\\models\\new #1\\a.pmx', '/models/it\'s.pmx'])
      expect(parseEnv(envQaLine(model)).AIRI_QA_MMD_MODEL).toBe(model)
  })
})
