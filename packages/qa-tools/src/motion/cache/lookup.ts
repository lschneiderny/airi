import type * as TypeScript from 'typescript'

import type { CreateRunOptions, RunGate } from '../../evidence/run'
import type { CacheEntry, StoreClock, StoredEntry } from './store'

import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, posix, resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { createRun } from '../../evidence/run'
import { normalizeModuleId } from './closure'
import { computeCacheKey, sha256Bytes } from './key'
import { defaultStoreRoot, readEntries, writeEntry } from './store'

type ClosureEntry = CacheEntry['closure'][number]

const ClosureFileSchema = v.array(v.object({ repoPath: v.string(), sha256: v.string() }))
const closureFilePattern = /^closure-(vite|cli)-\d+\.json$/
const tsconfigPattern = /^tsconfig.*\.json$/
const nodeRequire = createRequire(import.meta.url)
/** The one config file whose own local imports (a reporter, for example) shape every run. */
const vitestConfigPath = 'packages/qa-tools/vitest.config.ts'
const localImportPattern = /\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*(?:\(\s*)?['"](\.{1,2}\/[^'"]+)['"]/g
const sourceFilePattern = /\.(?:[cm]?[jt]s|tsx)$/
const importSuffixes = ['', '.ts', '.mts', '.js', '.mjs', '.json', '/index.ts']

export interface CachePlan {
  storeRoot: string
  key: string
  /** Taken before the key is computed: a closure file modified at or after this instant cannot be trusted. */
  startedAtMs: number
  /** The key again, from the files as they are now. A different value means an input changed during the run. */
  recomputeKey: () => string
}

export interface PrepareCacheInput {
  repoRoot: string
  args: unknown
  env: NodeJS.ProcessEnv
  gateFileSha: () => string
  storeRoot?: string
}

/** Returns `null`, after saying why on stderr, when the key cannot be built: the run then proceeds uncached. */
export function prepareCache(input: PrepareCacheInput): CachePlan | null {
  const startedAtMs = Date.now()
  try {
    const storeRoot = input.storeRoot ?? defaultStoreRoot(input.repoRoot)
    const recomputeKey = () => computeCacheKey({ repoRoot: input.repoRoot, args: input.args, env: input.env, gateFileSha: input.gateFileSha() })
    return { storeRoot, key: recomputeKey(), startedAtMs, recomputeKey }
  }
  catch (error) {
    console.error(`QA cache disabled for this run: ${errorMessageFrom(error) ?? 'unknown error'}`)
    return null
  }
}

function isSafeRepoPath(repoPath: string): boolean {
  return repoPath !== '' && !isAbsolute(repoPath) && !repoPath.includes('\\') && !/^[a-z]:/i.test(repoPath) && !repoPath.split('/').some(part => part === '..' || part === '' || part === '.')
}

function hashRepoFile(repoRoot: string, repoPath: string): string | null {
  try {
    return sha256Bytes(readFileSync(resolve(repoRoot, repoPath)))
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR'))
      return null
    throw error
  }
}

/** True only when every recorded file still exists with the same raw bytes. */
export function closureMatches(repoRoot: string, closure: readonly ClosureEntry[]): boolean {
  return closure.length > 0 && closure.every(item => isSafeRepoPath(item.repoPath) && hashRepoFile(repoRoot, item.repoPath) === item.sha256)
}

/** `--fresh` skips the lookup; the result of the run is still stored afterwards. */
export function lookupResult(plan: CachePlan, repoRoot: string, fresh: boolean): StoredEntry | null {
  return fresh ? null : findHit(plan, repoRoot)
}

/** The newest entry of this key whose closure still matches the working tree, or `null`. */
export function findHit(plan: CachePlan, repoRoot: string): StoredEntry | null {
  for (const stored of readEntries(plan.storeRoot, plan.key)) {
    if (closureMatches(repoRoot, stored.entry.closure))
      return stored
  }
  return null
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

function tsconfigExtends(file: string): string[] {
  const ts = nodeRequire('typescript') as typeof TypeScript
  const value = (ts.readConfigFile(file, ts.sys.readFile).config as { extends?: unknown } | undefined)?.extends
  if (typeof value === 'string')
    return [value]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function resolveExtends(file: string, spec: string): string | undefined {
  if (spec.startsWith('.') || isAbsolute(spec)) {
    const base = resolve(dirname(file), spec)
    return [base, `${base}.json`].find(isFile)
  }
  const fromConfig = createRequire(file)
  for (const name of [spec, `${spec}.json`, `${spec}/tsconfig.json`]) {
    try {
      return fromConfig.resolve(name)
    }
    catch {
      // Not that spelling of the specifier; the next one may resolve.
    }
  }
  return undefined
}

/** Every config reached through `extends`, transitively, resolving relative and package specifiers. Dependencies drop out in normalization. */
function extendedConfigs(repoRoot: string, configs: Iterable<string>): string[] {
  const found = new Set<string>()
  const queue = [...configs]
  for (let repoPath = queue.pop(); repoPath !== undefined; repoPath = queue.pop()) {
    const file = resolve(repoRoot, repoPath)
    for (const spec of tsconfigExtends(file)) {
      const target = resolveExtends(file, spec)
      const next = target === undefined ? undefined : normalizeModuleId(target, repoRoot)
      if (next !== undefined && !found.has(next)) {
        found.add(next)
        queue.push(next)
      }
    }
  }
  return [...found]
}

/** Local relative files a source file imports, transitively. A regular expression is enough: this reads one known config. */
function localImports(repoRoot: string, repoPath: string): string[] {
  const seen = new Set([repoPath])
  const queue = [repoPath]
  for (let current = queue.pop(); current !== undefined; current = queue.pop()) {
    const file = resolve(repoRoot, current)
    if (!sourceFilePattern.test(file))
      continue
    for (const match of readFileSync(file, 'utf8').matchAll(localImportPattern)) {
      const base = resolve(dirname(file), match[1] ?? match[2])
      const target = importSuffixes.map(suffix => `${base}${suffix}`).find(isFile)
      const next = target === undefined ? undefined : normalizeModuleId(target, repoRoot)
      if (next !== undefined && !seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  seen.delete(repoPath)
  return [...seen]
}

/** `package.json` and `tsconfig*.json` beside the nearest manifest above each closure file, plus the configs those extend: build settings that change transforms. */
function ownerFiles(repoRoot: string, repoPaths: Iterable<string>): string[] {
  const owners = new Set<string>()
  for (const repoPath of repoPaths) {
    let dir = posix.dirname(repoPath)
    while (dir !== '.' && !existsSync(join(repoRoot, dir, 'package.json')))
      dir = posix.dirname(dir)
    owners.add(dir)
  }
  const files = new Set<string>()
  for (const dir of owners) {
    for (const name of readdirSync(join(repoRoot, dir))) {
      if (name === 'package.json' || tsconfigPattern.test(name))
        files.add(dir === '.' ? name : `${dir}/${name}`)
    }
  }
  const configs = [...files].filter(file => tsconfigPattern.test(posix.basename(file)))
  return [...files, ...extendedConfigs(repoRoot, configs)]
}

export interface RecordInput {
  plan: CachePlan
  repoRoot: string
  runDir: string
  sourceRunId: string
  exitCode: number
  timedOut?: boolean
  summary: string
  /** Result files in `runDir` that a hit replays. */
  artifacts: string[]
  clock?: StoreClock
}

export type RecordOutcome = { stored: true, entryId: string } | { stored: false, reason: string }

function readRunClosures(runDir: string): { vite: ClosureEntry[][], cli: ClosureEntry[][] } {
  const closures: { vite: ClosureEntry[][], cli: ClosureEntry[][] } = { vite: [], cli: [] }
  for (const name of readdirSync(runDir)) {
    const match = closureFilePattern.exec(name)
    if (match)
      closures[match[1] as 'vite' | 'cli'].push(v.parse(ClosureFileSchema, JSON.parse(readFileSync(join(runDir, name), 'utf8'))))
  }
  return closures
}

/** Stores a finished run's result unless it cannot be trusted as a function of the key and the closure. */
export function recordResult(input: RecordInput): RecordOutcome {
  const { plan, repoRoot } = input
  if (input.exitCode !== 0 && input.exitCode !== 1)
    return { stored: false, reason: `exit code ${input.exitCode} is not stored` }
  if (input.timedOut)
    return { stored: false, reason: 'the run timed out' }
  if (plan.recomputeKey() !== plan.key)
    return { stored: false, reason: 'a key input changed during the run' }
  if (!input.artifacts.length || !input.artifacts.every(name => existsSync(join(input.runDir, name))))
    return { stored: false, reason: 'the run has no result artifacts' }

  const closures = readRunClosures(input.runDir)
  if (!closures.vite.length || !closures.cli.length)
    return { stored: false, reason: 'the run did not record both the worker and CLI module closures' }
  const captured = new Map<string, string>()
  for (const item of [...closures.vite, ...closures.cli].flat()) {
    if (!isSafeRepoPath(item.repoPath))
      return { stored: false, reason: `closure path ${JSON.stringify(item.repoPath)} is not a repository path` }
    if (captured.get(item.repoPath) !== undefined && captured.get(item.repoPath) !== item.sha256)
      return { stored: false, reason: `${item.repoPath} changed between the worker and the CLI` }
    captured.set(item.repoPath, item.sha256)
  }
  const roots = new Set([...captured.keys(), ...(captured.has(vitestConfigPath) ? localImports(repoRoot, vitestConfigPath) : [])])
  const closure: ClosureEntry[] = []
  for (const repoPath of [...new Set([...roots, ...ownerFiles(repoRoot, roots)])].sort()) {
    const sha256 = hashRepoFile(repoRoot, repoPath)
    if (sha256 === null || (captured.has(repoPath) && captured.get(repoPath) !== sha256))
      return { stored: false, reason: `${repoPath} changed during the run` }
    if (statSync(resolve(repoRoot, repoPath)).mtimeMs >= plan.startedAtMs)
      return { stored: false, reason: `${repoPath} was modified at or after the run start` }
    closure.push({ repoPath, sha256 })
  }
  const entry = writeEntry(plan.storeRoot, { key: plan.key, sourceRunId: input.sourceRunId, exitCode: input.exitCode, summary: input.summary, closure, artifacts: input.artifacts }, input.runDir, input.clock)
  return { stored: true, entryId: entry.entryId }
}

/** What `ClosureHooks` offers the CLI: its module closure, written into the run directory. */
export interface ClosureWriter {
  write: (runDir: string) => string
}

export interface CacheFinishedRunInput extends Omit<RecordInput, 'repoRoot'> {
  repoRoot: string
  closure: ClosureWriter | undefined
}

/** Records the CLI closure in the exact run directory, then stores the result. A storing failure never changes the run's exit code. */
export function cacheFinishedRun(input: CacheFinishedRunInput): void {
  try {
    input.closure?.write(input.runDir)
    const outcome = recordResult(input)
    console.info(outcome.stored ? `QA cache: stored ${outcome.entryId}` : `QA cache: not stored (${outcome.reason})`)
  }
  catch (error) {
    console.error(`QA cache: not stored (${errorMessageFrom(error) ?? 'unknown error'})`)
  }
}

export interface ReplayInput {
  hit: StoredEntry
  repoRoot: string
  label: string
  gate: RunGate
  startedAtMs: number
  /** Injectable for tests. */
  readGitState?: CreateRunOptions['readGitState']
}

/** Creates the run for a hit: marker, copied results, stored exit code. It starts no process and takes no lease. */
export function replayHit(input: ReplayInput): number {
  const { entry, dir } = input.hit
  const cache = { hit: true as const, sourceRunId: entry.sourceRunId, entryId: entry.entryId }
  let run: ReturnType<typeof createRun> | undefined
  // Run directories are named to the second, and a replay can finish within the second of the previous run.
  for (let offset = 0; run === undefined; offset++) {
    try {
      run = createRun({ tool: 'motion', label: input.label, repoRoot: input.repoRoot, gate: input.gate, cache, readGitState: input.readGitState, now: () => new Date(Date.now() + offset * 1000) })
    }
    catch (error) {
      if (offset >= 5 || !(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST')
        throw error
    }
  }
  for (const name of entry.artifacts) {
    copyFileSync(join(dir, name), run.path(name))
    run.addArtifact(name, name === 'summary.txt' ? 'summary' : 'report')
  }
  const wallSeconds = Math.round((Date.now() - input.startedAtMs) / 100) / 10
  writeFileSync(run.path('timing.json'), `${JSON.stringify({ wallSeconds, cached: true }, null, 2)}\n`)
  run.addArtifact('timing.json', 'timing')
  run.finish({ exitCode: entry.exitCode, summary: `cached from ${entry.sourceRunId}: ${entry.summary}` })
  console.info(`CACHED from ${entry.sourceRunId}`)
  if (entry.artifacts.includes('summary.txt'))
    console.info(readFileSync(run.path('summary.txt'), 'utf8'))
  console.info(`run ${run.runId} (${wallSeconds}s, cached)`)
  return entry.exitCode
}
