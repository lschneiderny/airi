import type { AcceptanceFinding, AcceptedCost, Git } from './accepted-costs'

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as v from 'valibot'

import { acceptanceFor, ACCEPTED_COSTS_PATH, AcceptedCostsSchema, defaultGit, gitAcceptancePredicates, introducingCommit, readAcceptedCosts } from './accepted-costs'

const entry: AcceptedCost = { id: 'mmd-physics-substeps', scenario: 'mmd-idle', metric: 'stageWindowCpuMsPerFrame', reason: 'Two physics substeps keep the skirt stable.', accepted: '2026-11-20' }

function issuesOf(input: unknown) {
  const result = v.safeParse(AcceptedCostsSchema, input)
  return result.success ? [] : result.issues.map(issue => issue.message)
}

describe('accepted costs schema', () => {
  it('accepts a valid entry', () => {
    expect(issuesOf({ entries: [entry] })).toEqual([])
  })

  it('rejects a reason that is empty after trimming', () => {
    expect(issuesOf({ entries: [{ ...entry, reason: '  ' }] })).not.toEqual([])
  })

  it('rejects an unknown metric', () => {
    expect(issuesOf({ entries: [{ ...entry, metric: 'stageSumMeanMs' }] })).not.toEqual([])
  })

  it('rejects an unknown scenario', () => {
    expect(issuesOf({ entries: [{ ...entry, scenario: 'mmd-dance' }] })).not.toEqual([])
  })

  it('rejects a duplicate id and names it', () => {
    expect(issuesOf({ entries: [entry, { ...entry, metric: 'fps' }] })).toEqual(['duplicate accepted-cost id: mmd-physics-substeps'])
  })

  it('rejects an id that is not kebab-case', () => {
    expect(issuesOf({ entries: [{ ...entry, id: 'Physics_Substeps' }] })).not.toEqual([])
  })

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(issuesOf({ entries: [{ ...entry, accepted: '20/11/2026' }] })).not.toEqual([])
  })

  it('rejects a stored sha or measured value', () => {
    expect(issuesOf({ entries: [{ ...entry, sha: 'abc123' }] })).not.toEqual([])
  })

  it('accepts the committed file', () => {
    expect(readAcceptedCosts(resolve(import.meta.dirname, '../../../..')).entries).toBeInstanceOf(Array)
  })
})

describe('readAcceptedCosts', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'qa-accepted-costs-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads no entries from a checkout without the file', () => {
    expect(readAcceptedCosts(root)).toEqual({ entries: [] })
  })
})

/** A fake git whose history of the accepted-costs file is `versions`, oldest first. */
function fakeHistory(versions: Record<string, string>): Git {
  return async (args) => {
    if (args[0] === 'log')
      return `${Object.keys(versions).join('\n')}\n`
    if (args[0] === 'show') {
      const sha = String(args[1]).split(':')[0]!
      return versions[sha]!
    }
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
}

describe('introducingCommit', () => {
  it('returns the first version whose entries contain the id', async () => {
    const git = fakeHistory({
      a1: '{ "entries": [] }',
      b2: JSON.stringify({ entries: [entry] }),
      c3: JSON.stringify({ entries: [entry, { ...entry, id: 'later' }] }),
    })
    expect(await introducingCommit(entry.id, 'main', git)).toBe('b2')
  })

  it('ignores a reformatted file and an id that only appears in text', async () => {
    const git = fakeHistory({
      a1: JSON.stringify({ entries: [{ ...entry, id: 'other', reason: `Unlike mmd-physics-substeps, this is cheap.` }] }),
      b2: JSON.stringify({ entries: [entry] }),
      c3: JSON.stringify({ entries: [entry] }, null, 4),
    })
    expect(await introducingCommit(entry.id, 'main', git)).toBe('b2')
  })

  it('returns null when no version contains the id', async () => {
    expect(await introducingCommit(entry.id, 'main', fakeHistory({ a1: '{ "entries": [] }' }))).toBeNull()
  })
})

/** A fake commit graph: `ancestors[c]` lists every commit reachable from `c`, including `c`. */
function fakeAncestry(ancestors: Record<string, string[]>) {
  return async (a: string, b: string) => ancestors[b]?.includes(a) ?? false
}

describe('acceptanceFor', () => {
  // base -> s1 -> s2 (the finding's subject) -> late; side branches off base.
  const isAncestor = fakeAncestry({
    base: ['base'],
    s1: ['base', 's1'],
    s2: ['base', 's1', 's2'],
    late: ['base', 's1', 's2', 'late'],
    side: ['base', 'side'],
  })
  const rangeLandedIn = async () => false
  const finding: AcceptanceFinding = { scenario: 'mmd-idle', metric: 'stageWindowCpuMsPerFrame', baseline: 'base', subject: 's2' }

  it('accepts an entry introduced inside the range', async () => {
    expect(await acceptanceFor({ entry, introducing: 's1', finding, isAncestor, rangeLandedIn })).toBe(true)
  })

  it('accepts an entry introduced in the subject itself', async () => {
    expect(await acceptanceFor({ entry, introducing: 's2', finding, isAncestor, rangeLandedIn })).toBe(true)
  })

  it('accepts an entry committed after the subject', async () => {
    expect(await acceptanceFor({ entry, introducing: 'late', finding, isAncestor, rangeLandedIn })).toBe(true)
  })

  it('rejects an entry on an unrelated branch', async () => {
    expect(await acceptanceFor({ entry, introducing: 'side', finding, isAncestor, rangeLandedIn })).toBe(false)
  })

  it('rejects an entry introduced at or before the baseline', async () => {
    expect(await acceptanceFor({ entry, introducing: 'base', finding, isAncestor, rangeLandedIn })).toBe(false)
  })

  it('rejects an entry for another metric', async () => {
    expect(await acceptanceFor({ entry: { ...entry, metric: 'fps' }, introducing: 's1', finding, isAncestor, rangeLandedIn })).toBe(false)
  })

  it('rejects an entry for another scenario', async () => {
    expect(await acceptanceFor({ entry: { ...entry, scenario: 'live2d-idle' }, introducing: 's1', finding, isAncestor, rangeLandedIn })).toBe(false)
  })

  it('accepts an entry whose history holds a patch-equivalent of the whole range', async () => {
    expect(await acceptanceFor({ entry, introducing: 'side', finding, isAncestor, rangeLandedIn: async () => true })).toBe(true)
  })
})

describe('against a real repository', () => {
  let repo: string

  /** Runs git in the temp repo; `beforeEach` pins the identity and hides the host and system configuration. */
  function run(...args: string[]) {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
  }

  function commitFile(path: string, content: string, message: string) {
    writeFileSync(join(repo, path), content)
    run('add', '--', path)
    run('commit', '--quiet', '-m', message)
    return run('rev-parse', 'HEAD')
  }

  function writeCosts(entries: AcceptedCost[], message: string) {
    mkdirSync(join(repo, 'packages/qa-tools/perf'), { recursive: true })
    return commitFile(ACCEPTED_COSTS_PATH, `${JSON.stringify({ entries }, null, 2)}\n`, message)
  }

  beforeEach(() => {
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
    vi.stubEnv('GIT_AUTHOR_NAME', 'Example')
    vi.stubEnv('GIT_AUTHOR_EMAIL', 'user@example.com')
    vi.stubEnv('GIT_COMMITTER_NAME', 'Example')
    vi.stubEnv('GIT_COMMITTER_EMAIL', 'user@example.com')
    repo = mkdtempSync(join(tmpdir(), 'qa-accepted-costs-git-'))
    run('init', '--quiet', '--initial-branch=main')
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('accepts a PR finding after the PR and its entry are rebase-merged', async () => {
    const base = writeCosts([], 'base')
    run('switch', '--quiet', '-c', 'pr')
    const subject = commitFile('stage.ts', 'export const substeps = 2\n', 'more substeps')
    writeCosts([entry], 'accept the substeps cost')
    run('switch', '--quiet', 'main')
    commitFile('other.ts', 'export const other = 1\n', 'unrelated main work')
    run('rebase', '--quiet', 'main', 'pr')
    run('switch', '--quiet', 'main')
    run('merge', '--quiet', '--ff-only', 'pr')

    const git = defaultGit(repo)
    const landed = await introducingCommit(entry.id, 'main', git)
    expect(landed).toBe(run('rev-parse', 'main'))
    const finding: AcceptanceFinding = { scenario: entry.scenario, metric: entry.metric, baseline: base, subject }
    expect(await acceptanceFor({ entry, introducing: landed!, finding, ...gitAcceptancePredicates(git) })).toBe(true)
  })

  it('rejects a PR finding against an entry that predates the PR', async () => {
    const base = writeCosts([entry], 'accept early')
    run('switch', '--quiet', '-c', 'pr')
    const subject = commitFile('stage.ts', 'export const substeps = 2\n', 'more substeps')
    run('switch', '--quiet', '--detach', base)
    const unrelated = commitFile('other.ts', 'export const other = 1\n', 'unrelated')

    const git = defaultGit(repo)
    const finding: AcceptanceFinding = { scenario: entry.scenario, metric: entry.metric, baseline: base, subject }
    expect(await acceptanceFor({ entry, introducing: unrelated, finding, ...gitAcceptancePredicates(git) })).toBe(false)
  })

  it('returns the rewritten sha after the history is rebased onto a new root', async () => {
    const original = writeCosts([entry], 'accept')
    run('switch', '--quiet', '--orphan', 'root')
    const root = commitFile('readme.md', 'root\n', 'new root')
    run('rebase', '--quiet', '--onto', root, '--root', 'main')

    const rewritten = run('rev-parse', 'main')
    expect(rewritten).not.toBe(original)
    expect(await introducingCommit(entry.id, 'main', defaultGit(repo))).toBe(rewritten)
  })
})
