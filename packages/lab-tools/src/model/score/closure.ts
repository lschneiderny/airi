import type { ClosureEntry } from '@proj-airi/qa-tools/motion/cache/closure'

import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { normalizeModuleId } from '@proj-airi/qa-tools/motion/cache/closure'
import { sha256Bytes } from '@proj-airi/qa-tools/motion/cache/key'

/** Model provenance ignores checkout CRLF, preserving every other byte, including lone CR. */
export function captureScoreClosure(ids: Iterable<string>, repoRoot: string): ClosureEntry[] {
  const paths = new Set<string>()
  for (const id of ids) {
    const path = normalizeModuleId(id, repoRoot)
    if (path !== undefined)
      paths.add(path)
  }
  return [...paths].sort().map((repoPath) => {
    // Latin-1 round-trips bytes without replacing invalid UTF-8 sequences.
    const bytes = readFileSync(resolve(repoRoot, repoPath)).toString('latin1').replaceAll('\r\n', '\n')
    return { repoPath, sha256: sha256Bytes(Buffer.from(bytes, 'latin1')) }
  })
}

/**
 * The identity of a scorer closure: a hash over its sorted file hashes alone. Paths are left out, so moving or renaming
 * a file with the same bytes leaves the digest unchanged; the closure's `files` keep the paths for reading.
 */
export function closureDigest(files: readonly ClosureEntry[]): string {
  return sha256Bytes(Buffer.from(JSON.stringify(files.map(file => file.sha256).sort())))
}
