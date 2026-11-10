import type { LastVerifyPass, VerifiedTree, VerifyScope } from './verify-plan'

import process from 'node:process'

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { verifySteps } from './verify-plan'

/**
 * Passing verification results keyed by content. A key covers the working tree hash and the exact
 * command, so a hit means this step already passed on these files with these tools. Failures are
 * never stored, so they always rerun.
 */
export interface VerifyPass {
  key: string
  step: string
  tree: string
  command: string[]
  passedAt: string
  durationMs: number
  scopeBase: string
  mode: VerifyScope['mode']
}

const maxAgeMs = 30 * 24 * 60 * 60 * 1000
const objectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

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

export function verifyCacheKey(parts: { tree: string, step: string, command: string[], node: string, platform: string }): string {
  return createHash('sha256').update(JSON.stringify([parts.tree, parts.step, parts.command, parts.node, parts.platform])).digest('hex')
}

export function readPass(dir: string, key: string): VerifyPass | null {
  const file = join(dir, `${key}.json`)
  if (!existsSync(file))
    return null
  try {
    const pass = JSON.parse(readFileSync(file, 'utf8')) as VerifyPass
    return pass.key === key ? pass : null
  }
  catch {
    // A torn or hand-edited entry is a miss; the step reruns and rewrites it.
    return null
  }
}

/** Writes through a temporary file and a rename, so a concurrent reader in another worktree never sees a partial entry. */
export function writePass(dir: string, pass: VerifyPass, now = Date.now()): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${pass.key}.json`)
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(pass, null, 2)}\n`)
  renameSync(temporary, file)
  for (const name of readdirSync(dir)) {
    const entry = join(dir, name)
    if (name.endsWith('.json') && now - statSync(entry).mtimeMs > maxAgeMs)
      rmSync(entry, { force: true })
  }
}
