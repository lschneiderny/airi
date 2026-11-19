import type { ClosureEntry } from '../../motion/cache/closure'

import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { normalizeModuleId } from '../../motion/cache/closure'
import { sha256Bytes } from '../../motion/cache/key'

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
