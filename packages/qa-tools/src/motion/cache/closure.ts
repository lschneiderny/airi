import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ClosureEntry {
  repoPath: string
  sha256: string
}

function portablePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^[A-Z]:/, drive => drive.toLowerCase())
}

/** Resolve workspace links before excluding dependencies, retaining only repository files. */
export function normalizeModuleId(id: string, repoRoot: string): string | undefined {
  if (id.includes('\0') || id.startsWith('/@id/'))
    return undefined

  let path = id.split('?')[0]
  if (path.startsWith('/@fs/'))
    path = decodeURIComponent(path.slice('/@fs/'.length))
  else if (path.startsWith('file:'))
    path = fileURLToPath(path)
  if (!isAbsolute(path))
    return undefined

  let realPath: string
  try {
    realPath = portablePath(realpathSync(path))
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))
      return undefined
    throw error
  }
  const root = portablePath(realpathSync(repoRoot))
  const repoPath = posix.relative(root, realPath)
  if (!repoPath || repoPath === '..' || repoPath.startsWith('../') || posix.isAbsolute(repoPath) || /^[a-z]:/i.test(repoPath))
    return undefined
  if (repoPath.split('/').includes('node_modules'))
    return undefined
  return repoPath
}

/** Sorted, deduplicated source identities; hashes cover raw bytes, including line endings. */
export function captureClosure(ids: Iterable<string>, repoRoot: string): ClosureEntry[] {
  const paths = new Set<string>()
  for (const id of ids) {
    const path = normalizeModuleId(id, repoRoot)
    if (path !== undefined)
      paths.add(path)
  }
  return [...paths].sort().map(repoPath => ({
    repoPath,
    sha256: createHash('sha256').update(readFileSync(resolve(repoRoot, repoPath))).digest('hex'),
  }))
}
