import type { LastVerifyPass, VerifiedTree, VerifyScope, VerifyStep } from './verify-plan'

import process from 'node:process'

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { verifySteps } from './verify-plan'

/**
 * A step that passed at a clean git tree, shared by every worktree of this clone. `covers` lists the paths, relative to
 * the repository root, that the pass vouches for at that tree: what its own scope checked plus, for an incremental pass,
 * what the recorded passes it continued from had checked (the same trust the per-branch `last` record gives).
 */
export interface TreePass {
  readonly kind: 'pass'
  readonly step: VerifyStep
  readonly tree: string
  readonly toolchain: string
  readonly envKey: string
  readonly mode: VerifyScope['mode']
  readonly covers: readonly string[]
  readonly coverBase: string
  readonly worktree: string
  readonly branch: string | null
  readonly at: string
  readonly durationMs: number
}

/** A step that failed at a tree. It outranks every earlier pass of that step at that tree, so a flaky failure is never hidden. */
export interface TreeFailure {
  readonly kind: 'failure'
  readonly step: VerifyStep
  readonly tree: string
  readonly toolchain: string
  readonly envKey: string
  readonly worktree: string
  readonly at: string
}

export type TreeRecord = TreePass | TreeFailure

export interface ReuseRequest {
  readonly step: VerifyStep
  readonly tree: string
  readonly toolchain: string
  readonly envKey: string
  /** `--gate` trusts only passes that checked the whole branch themselves, never an incremental chain. */
  readonly gate: boolean
  /** Every path the requested scope would check. */
  readonly changed: readonly string[]
  /** No staged, unstaged or untracked (not ignored) file. */
  readonly clean: boolean
  readonly noCache: boolean
}

export type ReuseDecision = { kind: 'reuse', pass: TreePass } | { kind: 'run', reason: string }

const maxAgeMs = 30 * 24 * 60 * 60 * 1000
export const maxTreeRecords = 2_000
const objectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

/** Node version and platform: a pass under another toolchain proves nothing here. */
export function toolchainOf(version: string, platform: string): string {
  return `${version} ${platform}`
}

/** `AIRI_QA_*` variables turn environment-gated tests on, so a pass without them does not cover a run with them. */
export function envKeyOf(env: NodeJS.ProcessEnv): string {
  const entries = Object.entries(env).filter(([name, value]) => name.startsWith('AIRI_QA_') && value !== undefined).sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16)
}

/**
 * Whether an earlier pass can stand for this step. The plan of every step grows with the set of changed paths (lint
 * files, typecheck packages and the all-packages trigger, related test files, browser projects), and a step's result at
 * a fixed tree is a function of what it checks, so a pass that covered a superset of the requested paths at the same
 * tree, toolchain and gated-test environment covers the request.
 */
export function decideReuse(request: ReuseRequest, records: readonly TreeRecord[]): ReuseDecision {
  if (request.noCache)
    return { kind: 'run', reason: 'cache disabled' }
  if (!request.clean)
    return { kind: 'run', reason: 'working tree has uncommitted or untracked files' }
  const same = records.filter(record => record.step === request.step && record.tree === request.tree && record.toolchain === request.toolchain && record.envKey === request.envKey)
  const passes = same.filter((record): record is TreePass => record.kind === 'pass')
  if (!passes.length)
    return { kind: 'run', reason: 'no pass at this tree' }
  const lastFailure = Math.max(-Infinity, ...same.filter(record => record.kind === 'failure').map(record => Date.parse(record.at)))
  const usable = passes.filter(pass => Date.parse(pass.at) > lastFailure)
  if (!usable.length)
    return { kind: 'run', reason: 'a later run at this tree failed' }
  const trusted = request.gate ? usable.filter(pass => pass.mode === 'branch') : usable
  if (!trusted.length)
    return { kind: 'run', reason: '--gate needs a pass that checked the whole branch itself' }
  const covering = trusted.filter((pass) => {
    const covered = new Set(pass.covers)
    return request.changed.every(path => covered.has(path))
  })
  if (!covering.length)
    return { kind: 'run', reason: 'no pass at this tree covers every requested file' }
  return { kind: 'reuse', pass: covering.reduce((newest, pass) => Date.parse(pass.at) > Date.parse(newest.at) ? pass : newest) }
}

/** Records are local JSON, but malformed or manually edited data must never narrow verification. */
export function readLastPass(dir: string, branch: string): LastVerifyPass | null {
  const file = join(dir, 'last', `${encodeURIComponent(branch)}.json`)
  if (!existsSync(file))
    return null
  try {
    const record: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!record || typeof record !== 'object' || !('mergeBase' in record) || typeof record.mergeBase !== 'string'
      || !objectId.test(record.mergeBase) || !('steps' in record) || !record.steps || typeof record.steps !== 'object') {
      return null
    }
    const steps: LastVerifyPass['steps'] = {}
    for (const [step, value] of Object.entries(record.steps)) {
      const known = verifySteps.find(known => known === step)
      if (!known)
        return null
      const entry: unknown = value
      if (!entry || typeof entry !== 'object'
        || !('tree' in entry) || typeof entry.tree !== 'string' || !objectId.test(entry.tree)
        || !('head' in entry) || typeof entry.head !== 'string' || !objectId.test(entry.head)
        || !('recordedAt' in entry) || typeof entry.recordedAt !== 'string' || !Number.isFinite(Date.parse(entry.recordedAt))) {
        return null
      }
      const verified: VerifiedTree = { tree: entry.tree, head: entry.head, recordedAt: entry.recordedAt }
      steps[known] = verified
    }
    return { mergeBase: record.mergeBase, steps }
  }
  catch (error) {
    if (error instanceof SyntaxError)
      return null
    throw error
  }
}

export function writeLastPass(dir: string, branch: string, record: LastVerifyPass): void {
  const last = join(dir, 'last')
  mkdirSync(last, { recursive: true })
  const file = join(last, `${encodeURIComponent(branch)}.json`)
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`)
  renameSync(temporary, file)
}

/** Records of one tree, newest last. A malformed or foreign file is skipped: it can only cause a rerun, never a narrower check. */
export function readTreeRecords(dir: string, tree: string): TreeRecord[] {
  if (!objectId.test(tree) || !existsSync(dir))
    return []
  const records: TreeRecord[] = []
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(`${tree}-`) || !name.endsWith('.json'))
      continue
    try {
      const record = parseTreeRecord(JSON.parse(readFileSync(join(dir, name), 'utf8')))
      if (record?.tree === tree)
        records.push(record)
    }
    catch (error) {
      // A record removed by another worktree's pruning between the listing and the read is a miss like a torn one.
      const vanished = error instanceof Error && 'code' in error && error.code === 'ENOENT'
      if (!(error instanceof SyntaxError) && !vanished)
        throw error
    }
  }
  return records.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

function parseTreeRecord(value: unknown): TreeRecord | null {
  if (!value || typeof value !== 'object')
    return null
  const record = value as Record<string, unknown>
  const text = (key: string) => typeof record[key] === 'string' ? record[key] : null
  const step = verifySteps.find(known => known === record.step)
  const tree = text('tree')
  const at = text('at')
  const toolchain = text('toolchain')
  const envKey = text('envKey')
  const worktree = text('worktree')
  if (!step || !tree || !objectId.test(tree) || !at || !Number.isFinite(Date.parse(at)) || toolchain === null || envKey === null || worktree === null)
    return null
  if (record.kind === 'failure')
    return { kind: 'failure', step, tree, toolchain, envKey, worktree, at }
  const covers = record.covers
  const mode = record.mode
  const coverBase = text('coverBase')
  if (record.kind !== 'pass' || (mode !== 'branch' && mode !== 'incremental') || !Array.isArray(covers) || !covers.every(path => typeof path === 'string')
    || coverBase === null || (record.branch !== null && typeof record.branch !== 'string') || typeof record.durationMs !== 'number') {
    return null
  }
  return { kind: 'pass', step, tree, toolchain, envKey, mode, covers, coverBase, worktree, branch: record.branch, at, durationMs: record.durationMs }
}

/**
 * Writes through a temporary file and a rename, so a reader in another worktree never sees a partial record, then keeps
 * the store bounded: records older than 30 days go, and beyond `maxTreeRecords` the oldest go.
 */
export function writeTreeRecord(dir: string, record: TreeRecord, now = Date.now()): void {
  mkdirSync(dir, { recursive: true })
  const id = createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 16)
  const file = join(dir, `${record.tree}-${record.step}-${record.kind}-${id}.json`)
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`)
  renameSync(temporary, file)
  const entries = readdirSync(dir).filter(name => name.endsWith('.json')).flatMap((name) => {
    try {
      return [{ path: join(dir, name), mtimeMs: statSync(join(dir, name)).mtimeMs }]
    }
    catch {
      // Another worktree pruned it between the listing and the stat.
      return []
    }
  }).sort((a, b) => b.mtimeMs - a.mtimeMs)
  entries.forEach((entry, index) => {
    if (index >= maxTreeRecords || now - entry.mtimeMs > maxAgeMs)
      rmSync(entry.path, { force: true })
  })
}
