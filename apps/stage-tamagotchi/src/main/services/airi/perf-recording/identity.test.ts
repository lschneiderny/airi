import type { PerfExec } from './identity'

import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { PerfIdentity, perfIdentityChanged } from './identity'

const SHA = 'a'.repeat(40)
const buildInfo = { sha: 'b'.repeat(40), abbreviatedSha: 'bbbbbbb', branch: 'release' }
const buildInfoIdentity = {
  sha: buildInfo.sha,
  shortSha: buildInfo.abbreviatedSha,
  branch: 'release',
  dirty: null,
  diffHash: null,
  source: 'build-info',
}

interface FakeGit {
  head?: string
  branch?: string
  porcelain?: string
  diff?: string
  untracked?: Record<string, string>
  fail?: boolean
}

const blobHash = (content: string) => createHash('sha1').update(content).digest('hex')

function fakeExec(git: FakeGit, calls: string[][] = []): PerfExec {
  return async (command, args) => {
    calls.push([command, ...args])
    if (git.fail)
      throw new Error('git exploded')
    const [lock, ...rest] = args
    if (lock !== '--no-optional-locks')
      throw new Error(`git call without --no-optional-locks: ${args.join(' ')}`)
    const key = rest.join(' ')
    if (key === 'rev-parse HEAD')
      return `${git.head ?? SHA}\n`
    if (key === 'rev-parse --abbrev-ref HEAD')
      return `${git.branch ?? 'main'}\n`
    if (key === 'status --porcelain --untracked-files=normal')
      return git.porcelain ?? ''
    if (key === 'diff HEAD')
      return git.diff ?? ''
    if (key === 'ls-files --others --exclude-standard -z')
      return Object.keys(git.untracked ?? {}).map(name => `${name}\0`).join('')
    if (rest[0] === 'hash-object')
      return rest.slice(3).map(name => `${blobHash(git.untracked?.[name] ?? '')}\n`).join('')
    throw new Error(`unexpected git call: ${key}`)
  }
}

function createIdentity(options: { git?: FakeGit, dev?: boolean, gitEntries?: string[], calls?: string[][] } = {}) {
  const gitEntries = options.gitEntries ?? ['/repo/.git']
  return new PerfIdentity({
    dev: options.dev ?? true,
    appPath: '/repo/apps/stage-tamagotchi',
    buildInfo,
    exec: fakeExec(options.git ?? {}, options.calls),
    pathExists: async path => gitEntries.includes(path),
  })
}

describe('perfIdentity', () => {
  it('reports a clean tree without a diff hash', async () => {
    expect(await createIdentity().read()).toEqual({
      sha: SHA,
      shortSha: SHA.slice(0, 7),
      branch: 'main',
      dirty: false,
      diffHash: null,
      source: 'runtime-git',
    })
  })

  it('reports a dirty tree with a 64-hex hash of the diff', async () => {
    const identity = await createIdentity({ git: { porcelain: ' M a.ts\n', diff: 'diff --git a/a.ts' } }).read()

    expect(identity.dirty).toBe(true)
    expect(identity.diffHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes the hash when an untracked file appears, is renamed or only its content changes', async () => {
    const read = async (untracked: Record<string, string>) =>
      (await createIdentity({ git: { porcelain: ' M a.ts\n', diff: 'same', untracked } }).read()).diffHash

    const none = await read({})
    const added = await read({ 'new.ts': 'one' })

    expect(added).not.toBe(none)
    expect(await read({ 'other.ts': 'one' })).not.toBe(added)
    expect(await read({ 'new.ts': 'two' })).not.toBe(added)
    expect(await read({ 'new.ts': 'one' })).toBe(added)
  })

  it('hashes more untracked files than one hash-object batch holds', async () => {
    const many = Object.fromEntries(Array.from({ length: 250 }, (_, index) => [`file-${index}.ts`, `content ${index}`]))
    const calls: string[][] = []

    const identity = await createIdentity({ git: { porcelain: '?? dir/\n', untracked: many }, calls }).read()

    expect(identity.diffHash).toMatch(/^[0-9a-f]{64}$/)
    expect(calls.filter(call => call.includes('hash-object')).length).toBe(3)
  })

  it('records a detached HEAD as no branch', async () => {
    expect((await createIdentity({ git: { branch: 'HEAD' } }).read()).branch).toBeNull()
  })

  it('never exposes diff content or file names, only the hash', async () => {
    const identity = await createIdentity({ git: { porcelain: '?? secret-name.ts\n', diff: 'secret-diff-body', untracked: { 'secret-name.ts': 'secret-content' } } }).read()

    expect(JSON.stringify(identity)).not.toMatch(/secret/)
  })

  it('finds a .git file, as in a pnpm wt worktree', async () => {
    const calls: string[][] = []
    const identity = await createIdentity({ gitEntries: ['/repo/apps/.git'], calls }).read()

    expect(identity.source).toBe('runtime-git')
    expect(calls.length).toBeGreaterThan(0)
  })

  it('falls back to build info without spawning git when no repository is found', async () => {
    const calls: string[][] = []

    expect(await createIdentity({ gitEntries: [], calls }).read()).toEqual(buildInfoIdentity)
    expect(calls).toEqual([])
  })

  it('uses build info without spawning git outside a development build', async () => {
    const calls: string[][] = []

    expect(await createIdentity({ dev: false, calls }).read()).toEqual(buildInfoIdentity)
    expect(calls).toEqual([])
  })

  it('falls back to build info when git fails, without throwing', async () => {
    expect(await createIdentity({ git: { fail: true } }).read()).toEqual(buildInfoIdentity)
  })

  it('falls back to build info on garbage git output', async () => {
    expect(await createIdentity({ git: { head: 'not a sha at all' } }).read()).toEqual(buildInfoIdentity)
  })
})

describe('perfIdentityChanged', () => {
  const base = { sha: SHA, shortSha: 'aaaaaaa', branch: 'main', dirty: false, diffHash: null, source: 'runtime-git' } as const

  it('compares sha, dirty and diffHash only', () => {
    expect(perfIdentityChanged(base, { ...base, branch: 'other', shortSha: 'zzzzzzz' })).toBe(false)
    expect(perfIdentityChanged(base, { ...base, sha: 'c'.repeat(40) })).toBe(true)
    expect(perfIdentityChanged(base, { ...base, dirty: true })).toBe(true)
    expect(perfIdentityChanged(base, { ...base, diffHash: 'd'.repeat(64) })).toBe(true)
  })
})
