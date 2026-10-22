import type { CachePlan } from './lookup'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseGateArgs } from '../gate/cli'
import { parseValidateArgs } from '../validation/cli'
import { captureClosure, normalizeModuleId } from './closure'
import { computeCacheKey, sha256Bytes } from './key'
import { closureMatches, findHit, lookupResult, recordResult, replayHit } from './lookup'
import { keepPerKey, readEntries, writeEntry } from './store'

const runtime = { node: 'v24.0.0', platform: 'win32', arch: 'x64', vitestVersion: '4.1.11', vitestManifestSha: 'a'.repeat(64) }
const naturalMotion = 'packages/stage-ui-live2d/src/composables/live2d/natural-motion'
const closureFiles = [
  `${naturalMotion}/emotions.ts`,
  `${naturalMotion}/emotion-score.ts`,
  'packages/qa-tools/vitest.config.ts',
  'packages/qa-tools/src/motion/gate/trials.ts',
]
const baseArgs = { command: 'gate', target: 'emotion', level: 't1', emotions: ['angry', 'happy'], bands: ['strong'], seeds: 2 }

let sandbox: string
let repo: string
let store: string

function write(root: string, path: string, content: string | Buffer, mtime = new Date(Date.now() - 3_600_000)): void {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  utimesSync(file, mtime, mtime)
}

function populate(root: string): void {
  write(root, 'package.json', '{"name":"root"}\n')
  write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9\n')
  write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  write(root, 'patches/dep.patch', 'patch\n')
  write(root, 'packages/qa-tools/package.json', '{"name":"qa-tools","exports":{".":"./a.ts"}}\n')
  write(root, 'tsconfig.json', '// shared base\n{ "compilerOptions": { "strict": true, }, }\n')
  write(root, 'packages/tsconfig-base/package.json', '{"name":"@fixture/tsconfig"}\n')
  write(root, 'packages/tsconfig-base/tsconfig.json', '{}\n')
  if (!existsSync(join(root, 'node_modules', '@fixture', 'tsconfig'))) {
    mkdirSync(join(root, 'node_modules', '@fixture'), { recursive: true })
    symlinkSync(join(root, 'packages', 'tsconfig-base'), join(root, 'node_modules', '@fixture', 'tsconfig'), process.platform === 'win32' ? 'junction' : 'dir')
  }
  write(root, 'packages/qa-tools/tsconfig.json', '{"extends":"@fixture/tsconfig/tsconfig.json"}\n')
  write(root, 'packages/stage-ui-live2d/package.json', '{"name":"live2d"}\n')
  write(root, 'packages/stage-ui-live2d/tsconfig.json', '{ /* comment */ "extends": "../../tsconfig.json" }\n')
  write(root, 'packages/qa-tools/src/reporter.ts', 'import \'./nested\'\nexport {}\n')
  write(root, 'packages/qa-tools/src/nested.ts', 'export const nested = 1\n')
  for (const file of closureFiles)
    write(root, file, file === 'packages/qa-tools/vitest.config.ts' ? 'import \'./src/reporter\'\n' : `export const name = '${file}'\n`)
}

function keyOf(overrides: Partial<Parameters<typeof computeCacheKey>[0]> = {}, root = repo): string {
  return computeCacheKey({ repoRoot: root, args: baseArgs, env: { QA_GATE: 'g' }, gateFileSha: 'sha', runtime, ...overrides })
}

function planFor(root: string, storeRoot = store, startedAtMs = Date.now()): CachePlan {
  return { storeRoot, key: keyOf({}, root), startedAtMs, recomputeKey: () => keyOf({}, root) }
}

/** A finished run directory as the CLI leaves it: both closure files, the result, and the summary. */
function finishedRun(root: string, name = 'run-1'): string {
  const runDir = join(root, '.temp', 'qa', name)
  mkdirSync(runDir, { recursive: true })
  const closure = captureClosure(closureFiles.map(file => join(root, file)), root)
  writeFileSync(join(runDir, 'closure-vite-1.json'), JSON.stringify(closure))
  writeFileSync(join(runDir, 'closure-cli-2.json'), JSON.stringify(closure))
  writeFileSync(join(runDir, 'report.json'), '{"pass":false}\n')
  writeFileSync(join(runDir, 'summary.txt'), 'summary\n')
  return runDir
}

function record(root: string, plan: CachePlan, overrides: Partial<Parameters<typeof recordResult>[0]> = {}) {
  return recordResult({ plan, repoRoot: root, runDir: finishedRun(root), sourceRunId: 'run-1', exitCode: 0, summary: 'ok', artifacts: ['report.json', 'summary.txt'], ...overrides })
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'qa-cache-'))
  repo = join(sandbox, 'repo')
  store = join(sandbox, 'store')
  populate(repo)
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('cache key', () => {
  it('b1: each input alone changes the key, while QA_RUN_DIR and unrelated env do not', () => {
    const base = keyOf()
    const changed: Array<[string, string]> = [
      ['args', keyOf({ args: { ...baseArgs, seeds: 3 } })],
      ['QA env', keyOf({ env: { QA_GATE: 'g', QA_SEEDS: '1' } })],
      ['NODE_OPTIONS', keyOf({ env: { QA_GATE: 'g', NODE_OPTIONS: '--x' } })],
      ['NODE_ENV', keyOf({ env: { QA_GATE: 'g', NODE_ENV: 'production' } })],
      ['VITE_', keyOf({ env: { QA_GATE: 'g', VITE_A: '1' } })],
      ['VITEST_', keyOf({ env: { QA_GATE: 'g', VITEST_A: '1' } })],
      ['TZ', keyOf({ env: { QA_GATE: 'g', TZ: 'UTC' } })],
      ['gate file sha', keyOf({ gateFileSha: 'other' })],
      ['node', keyOf({ runtime: { ...runtime, node: 'v25.0.0' } })],
      ['platform', keyOf({ runtime: { ...runtime, platform: 'linux' } })],
      ['arch', keyOf({ runtime: { ...runtime, arch: 'arm64' } })],
      ['vitest version', keyOf({ runtime: { ...runtime, vitestVersion: '4.2.0' } })],
      ['vitest manifest', keyOf({ runtime: { ...runtime, vitestManifestSha: 'b'.repeat(64) } })],
    ]
    for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'patches/dep.patch']) {
      write(repo, file, 'edited\n')
      changed.push([file, keyOf()])
      populate(repo)
    }
    write(repo, 'patches/new.patch', 'new\n')
    changed.push(['new patch', keyOf()])
    rmSync(join(repo, 'patches', 'new.patch'))
    for (const [name, key] of changed)
      expect(key, name).not.toBe(base)
    expect(new Set(changed.map(([, key]) => key)).size).toBe(changed.length)
    expect(keyOf({ env: { QA_GATE: 'g', QA_RUN_DIR: 'x' } })).toBe(base)
    expect(keyOf({ env: { QA_GATE: 'g', qa_run_dir: 'y', PATH: 'z' } })).toBe(base)
  })

  it('b2: emotion order matters', () => {
    expect(keyOf({ args: { ...baseArgs, emotions: ['happy', 'angry'] } })).not.toBe(keyOf())
  })

  it('b12: the same content in another worktree has the same key and hits', () => {
    const other = join(sandbox, 'other-worktree')
    populate(other)
    expect(keyOf({}, other)).toBe(keyOf())
    expect(record(repo, planFor(repo)).stored).toBe(true)
    expect(findHit(planFor(other), other)?.entry.exitCode).toBe(0)
  })
})

describe('closure validation', () => {
  it('hits while nothing changed', () => {
    expect(record(repo, planFor(repo)).stored).toBe(true)
    expect(findHit(planFor(repo), repo)).not.toBeNull()
  })

  it('b3: a blob change, a deleted file, and a CRLF-only change each miss', () => {
    record(repo, planFor(repo))
    const file = `${naturalMotion}/emotions.ts`
    const original = readFileSync(join(repo, file))
    write(repo, file, `${original.toString()}// edit\n`)
    expect(findHit(planFor(repo), repo)).toBeNull()
    write(repo, file, original.toString().replaceAll('\n', '\r\n'))
    expect(findHit(planFor(repo), repo)).toBeNull()
    rmSync(join(repo, file))
    expect(findHit(planFor(repo), repo)).toBeNull()
    write(repo, file, original)
    expect(findHit(planFor(repo), repo)).not.toBeNull()
  })

  it('b4: an emotion-score.ts edit misses', () => {
    record(repo, planFor(repo))
    write(repo, `${naturalMotion}/emotion-score.ts`, 'export const name = "changed"\n')
    expect(findHit(planFor(repo), repo)).toBeNull()
  })

  it('b5: vitest.config.ts, a package.json exports field, and tsconfig each miss', () => {
    record(repo, planFor(repo))
    for (const [file, content] of [
      ['packages/qa-tools/vitest.config.ts', '// changed\n'],
      ['packages/qa-tools/package.json', '{"name":"qa-tools","exports":{".":"./b.ts"}}\n'],
      ['packages/qa-tools/tsconfig.json', '{"compilerOptions":{"jsx":"preserve"}}\n'],
      ['packages/stage-ui-live2d/package.json', '{"name":"live2d","exports":{}}\n'],
    ]) {
      const original = readFileSync(join(repo, file))
      write(repo, file, content)
      expect(findHit(planFor(repo), repo), file).toBeNull()
      write(repo, file, original)
    }
    expect(findHit(planFor(repo), repo)).not.toBeNull()
  })

  it('misses when a config reached through extends changes, by relative path or package specifier', () => {
    const plan = planFor(repo)
    record(repo, plan)
    const stored = readEntries(store, plan.key)[0].entry.closure.map(item => item.repoPath)
    expect(stored).toEqual(expect.arrayContaining(['tsconfig.json', 'packages/tsconfig-base/tsconfig.json']))
    for (const file of ['tsconfig.json', 'packages/tsconfig-base/tsconfig.json']) {
      const original = readFileSync(join(repo, file))
      write(repo, file, `${original.toString()}\n`)
      expect(findHit(plan, repo), file).toBeNull()
      write(repo, file, original)
    }
    expect(findHit(plan, repo)).not.toBeNull()
  })

  it('misses when a local import of vitest.config.ts changes, transitively', () => {
    const plan = planFor(repo)
    record(repo, plan)
    for (const file of ['packages/qa-tools/src/reporter.ts', 'packages/qa-tools/src/nested.ts']) {
      const original = readFileSync(join(repo, file))
      write(repo, file, `${original.toString()}// edit\n`)
      expect(findHit(plan, repo), file).toBeNull()
      write(repo, file, original)
    }
    expect(findHit(plan, repo)).not.toBeNull()
  })

  it('b6: normalization keeps repository files and drops query, virtual ids, dependencies, and outside paths', () => {
    write(repo, 'node_modules/dep/index.js', 'x')
    write(sandbox, 'outside.ts', 'x')
    const file = join(repo, closureFiles[0])
    expect(normalizeModuleId(`${file}?t=1`, repo)).toBe(closureFiles[0])
    expect(normalizeModuleId(`/@fs/${encodeURI(file.replaceAll('\\', '/'))}`, repo)).toBe(closureFiles[0])
    expect(normalizeModuleId('/@id/virtual:thing', repo)).toBeUndefined()
    expect(normalizeModuleId(`\0${file}`, repo)).toBeUndefined()
    expect(normalizeModuleId(join(repo, 'node_modules', 'dep', 'index.js'), repo)).toBeUndefined()
    expect(normalizeModuleId(join(sandbox, 'outside.ts'), repo)).toBeUndefined()
  })

  it('treats a corrupt, empty, or path-escaping entry as a miss', () => {
    const plan = planFor(repo)
    const stored = record(repo, plan)
    expect(stored.stored).toBe(true)
    const [{ dir, entry }] = readEntries(store, plan.key)
    writeFileSync(join(dir, 'entry.json'), '{"version":1,')
    expect(findHit(plan, repo)).toBeNull()
    writeFileSync(join(dir, 'entry.json'), JSON.stringify({ ...entry, artifacts: ['..\\evil.json'] }))
    expect(readEntries(store, plan.key)).toEqual([])
    expect(closureMatches(repo, [{ repoPath: '../outside.ts', sha256: sha256Bytes(Buffer.from('x')) }])).toBe(false)
    expect(closureMatches(repo, [])).toBe(false)
  })
})

describe('storing', () => {
  it('b7: a closure file modified at or after the run start stores nothing', () => {
    const file = join(repo, closureFiles[1])
    const plan = planFor(repo, store, statSync(file).mtimeMs)
    // Equal to the run start counts as at the start.
    expect(record(repo, { ...plan, startedAtMs: statSync(file).mtimeMs }).stored).toBe(false)
    write(repo, closureFiles[1], 'edited mid-run\n', new Date(Date.now() + 5000))
    const late = record(repo, planFor(repo))
    expect(late).toMatchObject({ stored: false })
    expect(readEntries(store, planFor(repo).key)).toEqual([])
  })

  it('stores nothing when a key input changed during the run', () => {
    const plan = planFor(repo)
    write(repo, 'pnpm-lock.yaml', 'lockfileVersion: 10\n')
    expect(record(repo, plan)).toMatchObject({ stored: false })
  })

  it('b8: exit 2 and a timeout are not stored; exits 0 and 1 are', () => {
    const plan = planFor(repo)
    expect(record(repo, plan, { exitCode: 2 }).stored).toBe(false)
    expect(record(repo, plan, { exitCode: 1, timedOut: true }).stored).toBe(false)
    expect(readEntries(store, plan.key)).toEqual([])
    expect(record(repo, plan, { exitCode: 0 }).stored).toBe(true)
    expect(record(repo, plan, { exitCode: 1 }).stored).toBe(true)
    expect(readEntries(store, plan.key).map(item => item.entry.exitCode)).toEqual([1, 0])
  })

  it('does not store a run without both closures or without results', () => {
    const plan = planFor(repo)
    const runDir = finishedRun(repo)
    rmSync(join(runDir, 'closure-cli-2.json'))
    expect(recordResult({ plan, repoRoot: repo, runDir, sourceRunId: 'r', exitCode: 0, summary: 's', artifacts: ['report.json'] })).toMatchObject({ stored: false })
    expect(record(repo, plan, { artifacts: ['missing.json'] })).toMatchObject({ stored: false })
  })

  it('b11: keeps only the newest 20 entries per key', () => {
    let tick = 1_000
    const clock = { now: () => ++tick, random: () => tick.toString(16).padStart(8, '0') }
    const plan = planFor(repo)
    const runDir = finishedRun(repo)
    for (let index = 0; index < keepPerKey + 5; index++)
      expect(recordResult({ plan, repoRoot: repo, runDir, sourceRunId: `r${index}`, exitCode: 0, summary: 's', artifacts: ['report.json'], clock }).stored).toBe(true)
    const kept = readEntries(store, plan.key)
    expect(kept).toHaveLength(keepPerKey)
    expect(kept[0].entry.sourceRunId).toBe(`r${keepPerKey + 4}`)
    expect(kept.at(-1)?.entry.sourceRunId).toBe('r5')
  })

  it('b10: two writer processes at once leave only whole entries', async () => {
    const plan = planFor(repo)
    const runDir = finishedRun(repo)
    const script = join(sandbox, 'writer.mjs')
    writeFileSync(script, `import { writeEntry } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'store.ts')).href)}\nfor (let i = 0; i < 15; i++)\n  writeEntry(process.argv[2], { key: process.argv[3], sourceRunId: 'w' + process.pid + '-' + i, exitCode: 0, summary: 's', closure: [{ repoPath: 'a.ts', sha256: 'x' }], artifacts: ['report.json'] }, process.argv[4])\n`)
    const run = () => new Promise<number | null>((done, fail) => {
      const child = spawn(process.execPath, ['--import', 'tsx', script, store, plan.key, runDir], { cwd: join(import.meta.dirname, '..', '..', '..'), stdio: 'inherit' })
      child.once('error', fail)
      child.once('close', done)
    })
    expect(await Promise.all([run(), run()])).toEqual([0, 0])
    const names = readdirSync(join(store, plan.key))
    expect(names.filter(name => name.startsWith('.tmp-'))).toEqual([])
    const entries = readEntries(store, plan.key)
    expect(entries).toHaveLength(names.length)
    expect(entries.length).toBeGreaterThanOrEqual(keepPerKey)
    expect(entries.length).toBeLessThanOrEqual(keepPerKey + 1)
  }, 30_000)

  it('writes the same id twice without tearing the first entry', () => {
    const plan = planFor(repo)
    const runDir = finishedRun(repo)
    const clock = { now: () => 5, random: () => 'abcdef01' }
    const entry = { key: plan.key, sourceRunId: 'r', exitCode: 0, summary: 's', closure: [], artifacts: ['report.json'] }
    writeEntry(store, entry, runDir, clock)
    try {
      writeEntry(store, entry, runDir, clock)
    }
    catch {
      // Windows refuses to rename over a non-empty directory; either outcome is a whole entry.
    }
    expect(readEntries(store, plan.key)).toHaveLength(1)
    expect(readdirSync(join(store, plan.key)).filter(name => name.startsWith('.tmp-'))).toEqual([])
  })
})

describe('replaying a hit', () => {
  const gate = { id: 'natural-emotion', version: '1', fileSha: 'sha' }
  const readGitState = () => ({ gitSha: 'abc', dirty: false })

  it('b9: a hit is byte-identical after the source run is deleted, carries the marker, and keeps the exit code', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const plan = planFor(repo)
    const runDir = finishedRun(repo)
    expect(recordResult({ plan, repoRoot: repo, runDir, sourceRunId: 'run-1', exitCode: 1, summary: 'failed', artifacts: ['report.json', 'summary.txt'] }).stored).toBe(true)
    const original = readFileSync(join(runDir, 'report.json'))
    rmSync(runDir, { recursive: true, force: true })

    const hit = findHit(plan, repo)
    expect(hit).not.toBeNull()
    const exitCode = replayHit({ hit: hit!, repoRoot: repo, label: 'gate-emotion-t1', gate, startedAtMs: Date.now(), readGitState })
    expect(exitCode).toBe(1)
    const runs = readdirSync(join(repo, '.temp', 'qa'))
    expect(runs).toHaveLength(1)
    const replayDir = join(repo, '.temp', 'qa', runs[0])
    expect(readFileSync(join(replayDir, 'report.json')).equals(original)).toBe(true)
    expect(existsSync(join(replayDir, 'vitest.log'))).toBe(false)
    const manifest = JSON.parse(readFileSync(join(replayDir, 'run.json'), 'utf8')) as { cache: unknown, result: { exitCode: number }, artifacts: Array<{ path: string }> }
    expect(manifest.cache).toEqual({ hit: true, sourceRunId: 'run-1', entryId: hit!.entry.entryId })
    expect(manifest.result.exitCode).toBe(1)
    expect(manifest.artifacts.map(item => item.path)).toEqual(['report.json', 'summary.txt', 'timing.json'])
  })

  it('creates distinct run directories for replays within the same second', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const plan = planFor(repo)
    record(repo, plan)
    const hit = findHit(plan, repo)!
    for (let index = 0; index < 3; index++)
      replayHit({ hit, repoRoot: repo, label: 'gate-emotion-t1', gate, startedAtMs: Date.now(), readGitState })
    expect(readdirSync(join(repo, '.temp', 'qa')).filter(name => name.endsWith('gate-emotion-t1'))).toHaveLength(3)
  })
})

describe('--fresh', () => {
  it('b13: skips the lookup but the run is still stored', () => {
    const plan = planFor(repo)
    expect(record(repo, plan).stored).toBe(true)
    expect(lookupResult(plan, repo, false)).not.toBeNull()
    expect(lookupResult(plan, repo, true)).toBeNull()
    expect(record(repo, plan).stored).toBe(true)
    expect(readEntries(store, plan.key)).toHaveLength(2)
  })

  it('is parsed by the gate and validation CLIs, and only at --level t1 for gates', () => {
    expect(parseGateArgs(['emotion', '--level', 't1', '--fresh'])).toMatchObject({ ok: true, command: { fresh: true } })
    expect(parseValidateArgs(['--level', 't1', '--fresh'])).toMatchObject({ ok: true, command: { fresh: true } })
    expect(parseGateArgs(['emotion', '--level', 't2', '--rig', 'forbooth', '--fresh'])).toMatchObject({ ok: false })
    expect(parseGateArgs(['emotion', '--level', 't1'])).toMatchObject({ ok: true, command: { fresh: false } })
  })
})
