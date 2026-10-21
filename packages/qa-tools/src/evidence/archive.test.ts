import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { archiveEvidence, EvidenceConflictError, resolveMainCheckout } from './archive'
import { sha256Buffer } from './run'

function writeEvidence(root: string, plan: string, name: string, content: string): void {
  const file = join(root, '.omo', 'evidence', plan, name)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, content)
}

describe('archiveEvidence', () => {
  let temp: string
  let from: string
  let main: string

  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'qa-archive-'))
    from = join(temp, 'worktree')
    main = join(temp, 'main')
    mkdirSync(from)
    mkdirSync(main)
  })

  afterEach(() => {
    rmSync(temp, { recursive: true, force: true })
  })

  const readManifest = () => JSON.parse(readFileSync(join(main, '.omo', 'evidence', 'demo', 'manifest.json'), 'utf8'))

  it('copies files and writes a manifest with sha256 per file', () => {
    writeEvidence(from, 'demo', 'a.txt', 'alpha')
    writeEvidence(from, 'demo', 'sub/b.txt', 'beta')

    const result = archiveEvidence({ plan: 'demo', from, main })

    expect(result.copied).toEqual(['a.txt', 'sub/b.txt'])
    expect(readFileSync(join(main, '.omo', 'evidence', 'demo', 'sub', 'b.txt'), 'utf8')).toBe('beta')
    expect(readManifest()).toEqual({
      plan: 'demo',
      files: [
        { path: 'a.txt', sha256: sha256Buffer(Buffer.from('alpha')), bytes: 5 },
        { path: 'sub/b.txt', sha256: sha256Buffer(Buffer.from('beta')), bytes: 4 },
      ],
    })
  })

  it('leaves the source untouched and no staging dirs behind', () => {
    writeEvidence(from, 'demo', 'a.txt', 'alpha')

    archiveEvidence({ plan: 'demo', from, main })

    expect(readFileSync(join(from, '.omo', 'evidence', 'demo', 'a.txt'), 'utf8')).toBe('alpha')
    expect(readdirSync(join(main, '.omo', 'evidence'))).toEqual(['demo'])
  })

  it('is idempotent: a second archive changes nothing', () => {
    writeEvidence(from, 'demo', 'a.txt', 'alpha')
    archiveEvidence({ plan: 'demo', from, main })
    const first = readFileSync(join(main, '.omo', 'evidence', 'demo', 'manifest.json'), 'utf8')

    const again = archiveEvidence({ plan: 'demo', from, main })

    expect(again.copied).toEqual([])
    expect(again.unchanged).toEqual(['a.txt'])
    expect(readFileSync(join(main, '.omo', 'evidence', 'demo', 'manifest.json'), 'utf8')).toBe(first)
  })

  it('adds new files and keeps existing destination files in the manifest', () => {
    writeEvidence(from, 'demo', 'a.txt', 'alpha')
    archiveEvidence({ plan: 'demo', from, main })
    writeEvidence(from, 'demo', 'c.txt', 'gamma')

    archiveEvidence({ plan: 'demo', from, main })

    expect(readManifest().files.map((f: { path: string }) => f.path)).toEqual(['a.txt', 'c.txt'])
  })

  it('refuses a same-named file with different bytes and copies nothing', () => {
    writeEvidence(from, 'demo', 'a.txt', 'alpha')
    writeEvidence(from, 'demo', 'z.txt', 'new')
    writeEvidence(main, 'demo', 'a.txt', 'CHANGED')

    expect(() => archiveEvidence({ plan: 'demo', from, main })).toThrow(EvidenceConflictError)

    const dest = join(main, '.omo', 'evidence', 'demo')
    expect(readFileSync(join(dest, 'a.txt'), 'utf8')).toBe('CHANGED')
    expect(readdirSync(dest)).toEqual(['a.txt'])
    expect(readdirSync(join(main, '.omo', 'evidence'))).toEqual(['demo'])
  })

  it('throws when the source evidence dir is missing', () => {
    expect(() => archiveEvidence({ plan: 'demo', from, main })).toThrow(/No evidence directory/)
  })

  it.each(['../x', 'a/b', '', '..', '.'])('rejects unsafe plan slug %j', (plan) => {
    expect(() => archiveEvidence({ plan, from, main })).toThrow(/Invalid plan slug/)
  })
})

describe('resolveMainCheckout', () => {
  it('parses the first worktree entry', () => {
    const output = 'worktree C:/repo/main\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/repo/wt\nHEAD def\n'
    expect(resolveMainCheckout('C:/repo/wt', () => output).replace(/\\/g, '/')).toMatch(/repo\/main$/)
  })

  it('throws when git reports no worktree', () => {
    expect(() => resolveMainCheckout('x', () => '')).toThrow(/No worktree entry/)
  })

  // Idle cost 0.36 s (real git init, commit and worktree add); 5.7 s under load, so 20 s.
  it('resolves the main checkout from a real linked worktree', () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'qa-wt-')))
    try {
      const repo = join(temp, 'repo')
      const linked = join(temp, 'linked')
      mkdirSync(repo)
      const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' })
      git('init', '-q')
      git('commit', '-q', '--allow-empty', '-m', 'init')
      git('worktree', 'add', '-q', '-b', 'side', linked)

      expect(realpathSync(resolveMainCheckout(linked))).toBe(realpathSync(repo))
    }
    finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }, 20_000)
})
