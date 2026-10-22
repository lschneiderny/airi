import process from 'node:process'

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import * as v from 'valibot'

export const keepPerKey = 20
const staleTemporaryMs = 60 * 60 * 1000
const keyPattern = /^[0-9a-f]{64}$/
const entryIdPattern = /^\d{15}-[0-9a-f]{8}$/

const EntrySchema = v.object({
  version: v.literal(1),
  key: v.string(),
  entryId: v.string(),
  createdAt: v.string(),
  sourceRunId: v.string(),
  exitCode: v.number(),
  summary: v.string(),
  closure: v.array(v.object({ repoPath: v.string(), sha256: v.string() })),
  // A plain file name: a hand-edited entry must not make a replay read or write outside its directories.
  artifacts: v.array(v.pipe(v.string(), v.regex(/^[\w.-]+$/))),
})

export type CacheEntry = v.InferOutput<typeof EntrySchema>

export interface StoredEntry {
  entry: CacheEntry
  dir: string
}

export interface StoreClock {
  now?: () => number
  random?: () => string
}

/** `<git common dir>/airi-qa-cache`: shared by every worktree of the clone. */
export function defaultStoreRoot(repoRoot: string): string {
  const common = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
  return join(resolve(common), 'airi-qa-cache')
}

function assertKey(key: string): void {
  if (!keyPattern.test(key))
    throw new Error(`Invalid cache key ${JSON.stringify(key)}`)
}

function entryDirs(keyDir: string): string[] {
  if (!existsSync(keyDir))
    return []
  return readdirSync(keyDir, { withFileTypes: true })
    .filter(item => item.isDirectory() && entryIdPattern.test(item.name))
    .map(item => item.name)
    .sort()
}

/**
 * Writes the entry into a private temporary directory and renames it into place, so a reader or a concurrent
 * writer sees a whole entry or none. Entry ids sort by creation time, which makes "newest 20" a name sort.
 */
export function writeEntry(storeRoot: string, entry: Omit<CacheEntry, 'version' | 'entryId' | 'createdAt'>, artifactsDir: string, clock: StoreClock = {}): CacheEntry {
  assertKey(entry.key)
  const now = (clock.now ?? Date.now)()
  const suffix = (clock.random ?? (() => Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0')))()
  const entryId = `${String(now).padStart(15, '0')}-${suffix}`
  const full: CacheEntry = { version: 1, ...entry, entryId, createdAt: new Date(now).toISOString() }
  const keyDir = join(storeRoot, entry.key)
  const temporary = join(keyDir, `.tmp-${process.pid}-${suffix}`)
  mkdirSync(temporary, { recursive: true })
  try {
    for (const name of entry.artifacts)
      copyFileSync(join(artifactsDir, name), join(temporary, name))
    writeFileSync(join(temporary, 'entry.json'), `${JSON.stringify(full, null, 2)}\n`)
    renameSync(temporary, join(keyDir, entryId))
  }
  catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
  prune(keyDir, now)
  return full
}

function prune(keyDir: string, now: number): void {
  // The entry is already stored; a directory another process is pruning or renaming right now is left for the next write.
  const surplus = entryDirs(keyDir).slice(0, -keepPerKey)
  const temporaries = readdirSync(keyDir, { withFileTypes: true }).filter(item => item.isDirectory() && item.name.startsWith('.tmp-')).map(item => item.name)
  for (const name of [...surplus, ...temporaries]) {
    const path = join(keyDir, name)
    try {
      if (surplus.includes(name) || now - statSync(path).mtimeMs > staleTemporaryMs)
        rmSync(path, { recursive: true, force: true })
    }
    catch {
      // Concurrent cleanup or a transient Windows sharing violation.
    }
  }
}

/** Entries of one key, newest first. An unreadable or malformed entry is skipped: the caller sees a miss. */
export function readEntries(storeRoot: string, key: string): StoredEntry[] {
  assertKey(key)
  const keyDir = join(storeRoot, key)
  const found: StoredEntry[] = []
  for (const name of entryDirs(keyDir).reverse()) {
    const dir = join(keyDir, name)
    try {
      const entry = v.parse(EntrySchema, JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8')))
      if (entry.key === key && entry.entryId === name && entry.artifacts.every(artifact => existsSync(join(dir, artifact))))
        found.push({ entry, dir })
    }
    catch {
      // A torn, hand-edited, or concurrently pruned entry is a miss.
    }
  }
  return found
}
