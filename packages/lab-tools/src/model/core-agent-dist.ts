import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The newest file modification time under `path` in milliseconds, or undefined when the path does not exist. */
export function newestMtime(path: string): number | undefined {
  if (!existsSync(path))
    return undefined
  if (statSync(path).isFile())
    return statSync(path).mtimeMs
  let newest: number | undefined
  for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile())
      continue
    const mtime = statSync(join(entry.parentPath, entry.name)).mtimeMs
    newest = newest === undefined ? mtime : Math.max(newest, mtime)
  }
  return newest
}

/**
 * Refuses to replay replies through a core-agent build that is missing or older than its runtime source.
 *
 * Use when:
 * - A command imports `@proj-airi/core-agent`, whose exports resolve to `dist`, to replay replies as the app does.
 *   A stale build would replay with old cue rules and report them as current.
 *
 * Call it before the dynamic import, so a missing build gets this actionable refusal instead of an import error.
 *
 * Returns:
 * - The absolute path of the checked dist entry, for provenance hashes.
 */
export function assertCoreAgentDistCurrent(repoRoot: string, mtime: (path: string) => number | undefined = newestMtime): string {
  const dist = resolve(repoRoot, 'packages/core-agent/dist/index.mjs')
  const distMtime = mtime(dist)
  const sourceMtime = mtime(resolve(repoRoot, 'packages/core-agent/src/runtime'))
  if (distMtime === undefined || (sourceMtime !== undefined && distMtime < sourceMtime))
    throw new Error(`${dist} is ${distMtime === undefined ? 'missing' : 'older than packages/core-agent/src/runtime'}; run pnpm -F @proj-airi/core-agent build`)
  return dist
}
