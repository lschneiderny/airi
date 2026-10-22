import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export class StaleBuildError extends Error {
  constructor() {
    super('cpu-slots: dist/vitest.mjs is stale (src changed); run pnpm -F @proj-airi/cpu-slots build')
    this.name = 'StaleBuildError'
  }
}

/** The build replaces this with the bundled source files and their hash. Running from src leaves it as is. */
const buildStamp = '__CPU_SLOTS_BUILD_STAMP__'

/** Hashes the given files of `srcDir`, with line endings normalized so a checkout setting cannot change it. */
export function hashSources(srcDir: string, files: string[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort())
    hash.update(`${file}\0${readFileSync(join(srcDir, file), 'utf8').replace(/\r\n/g, '\n')}\0`)
  return hash.digest('hex')
}

/**
 * Fails when the sources bundled into dist/vitest.mjs changed after it was built, because nothing but
 * postinstall rebuilds it. Skipped when running from src, or when src is absent (a published package).
 */
export function assertFreshBuild(srcDir = fileURLToPath(new URL('../src/', import.meta.url)), stamp = buildStamp): void {
  if (stamp.startsWith('__') || !existsSync(srcDir))
    return
  const built = JSON.parse(stamp) as { hash: string, files: string[] }
  let current: string | undefined
  try {
    current = hashSources(srcDir, built.files)
  }
  catch {
    // A bundled source file no longer exists, which also means the build is stale.
  }
  if (current !== built.hash)
    throw new StaleBuildError()
}
