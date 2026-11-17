import type { LastVerifyPass, VerifiedTree } from './verify-plan'

import process from 'node:process'

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { verifySteps } from './verify-plan'

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
