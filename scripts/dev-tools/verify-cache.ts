import process from 'node:process'

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
}

const maxAgeMs = 30 * 24 * 60 * 60 * 1000

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
