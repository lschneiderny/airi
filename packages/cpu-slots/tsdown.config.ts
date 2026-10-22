import process from 'node:process'

import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import * as nodeFs from 'node:fs'

import { defineConfig } from 'tsdown'

const srcDir = resolve(import.meta.dirname, 'src')
const distDir = resolve(import.meta.dirname, 'dist')
// NOTICE:
// Vitest configs load dist/vitest.mjs at any moment, so the build stages into dist-<pid> instead of dist.
// tsdown cleans and writes its outDir in place, so a load could read a missing wrapper.
// Source: commit 639979638; `replaceFiles` renames each staged file over dist.
// Removal condition: tsdown publishes its outDir atomically.
const cacheDir = resolve(import.meta.dirname, 'node_modules', '.cache')
const stagingDir = join(cacheDir, `dist-${process.pid}`)
const placeholder = '__CPU_SLOTS_BUILD_STAMP__'

// NOTICE:
// This repeats hashSources from src/stale-build.ts and the isAlive probe from src/liveness.ts.
// tsdown loads this config natively, and Node cannot resolve the extension-less imports of src/.
// test/vitest-wrapper.test.ts fails when the two hashSources drift apart.
// Removal condition: tsdown loads its config through a loader that resolves extension-less imports.
function hashSources(files: string[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort())
    hash.update(`${file}\0${nodeFs.readFileSync(join(srcDir, file), 'utf8').replace(/\r\n/g, '\n')}\0`)
  return hash.digest('hex')
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The file system calls `removeStaleStaging` makes. Tests inject them. */
export type StagingFs = Pick<typeof nodeFs, 'existsSync' | 'readdirSync' | 'rmSync'>

/**
 * Deletes the `dist-<pid>` staging directories in `dir` whose build process is gone, and returns their
 * names. A build that crashes before `build:done` leaves its directory, and only a completed
 * `replaceFiles` removes one. A directory whose pid a later process reuses stays until that process exits.
 */
export function removeStaleStaging(dir: string, options: { fs?: StagingFs, alive?: (pid: number) => boolean } = {}): string[] {
  const { fs = nodeFs, alive = pidAlive } = options
  if (!fs.existsSync(dir))
    return []
  const removed: string[] = []
  for (const name of fs.readdirSync(dir)) {
    const pid = Number(/^dist-(\d+)$/.exec(name)?.[1])
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid || alive(pid))
      continue
    try {
      fs.rmSync(join(dir, name), { recursive: true, force: true })
      removed.push(name)
    }
    catch (error) {
      // A leftover only wastes disk space, so it must not fail the build; the next build tries again.
      console.warn(`cpu-slots: could not remove the stale build directory ${join(dir, name)} (${String(error)})`)
    }
  }
  return removed
}

/** The file system calls `replaceFiles` makes. Tests inject failures through it. */
export type ReplaceFs = Pick<typeof nodeFs, 'existsSync' | 'mkdirSync' | 'readFileSync' | 'readdirSync' | 'renameSync' | 'rmSync'>

export interface ReplaceFilesOptions {
  fs?: ReplaceFs
  delay?: (ms: number) => Promise<unknown>
  attempts?: number
}

/** Windows fails a rename over a file with these while another process has the file open. */
const transientCodes = new Set(['EBUSY', 'EACCES', 'EPERM'])

function listFiles(fs: ReplaceFs, dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)))
}

/**
 * Moves every file of `fromDir` over the same path in `toDir`, then deletes the files of `toDir` that
 * `fromDir` did not have, then deletes `fromDir`. A rename replaces its target atomically on NTFS and
 * POSIX, so a reader of `toDir` always sees a complete old or a complete new file, never a missing one.
 * A target whose bytes already match is left untouched, so an unchanged rebuild changes nothing in
 * `toDir`, and Turbo does not restore its cached copy over it in place on the next cache hit.
 */
export async function replaceFiles(fromDir: string, toDir: string, options: ReplaceFilesOptions = {}): Promise<void> {
  const { fs = nodeFs, delay = sleep, attempts = 10 } = options

  async function retry(action: () => void): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        return action()
      }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (attempt >= attempts || code === undefined || !transientCodes.has(code))
          throw error
        await delay(50 * attempt)
      }
    }
  }

  const files = listFiles(fs, fromDir)
  if (files.length === 0)
    throw new Error(`cpu-slots: the build wrote no files to ${fromDir}`)

  for (const file of files) {
    const source = join(fromDir, file)
    const target = join(toDir, file)
    if (fs.existsSync(target) && fs.readFileSync(target).equals(fs.readFileSync(source)))
      continue
    fs.mkdirSync(dirname(target), { recursive: true })
    await retry(() => fs.renameSync(source, target))
  }
  const emitted = new Set(files)
  for (const file of listFiles(fs, toDir)) {
    if (!emitted.has(file))
      await retry(() => fs.rmSync(join(toDir, file), { force: true }))
  }
  fs.rmSync(fromDir, { recursive: true, force: true })
}

export default defineConfig({
  entry: ['src/vitest.ts'],
  outDir: stagingDir,
  dts: true,
  hooks: {
    'build:prepare': () => {
      removeStaleStaging(cacheDir)
    },
    'build:done': () => replaceFiles(stagingDir, distDir),
  },
  // The types belong to the consuming project's own vitest and vite, so they stay imports.
  deps: { neverBundle: [/^vite(st)?(\/|$)/] },
  plugins: [{
    name: 'cpu-slots:build-stamp',
    // Records the sources bundled into the entry and their hash, which the wrapper checks when it loads.
    renderChunk(code, chunk) {
      if (!code.includes(placeholder))
        return null
      const files = chunk.moduleIds
        .map(id => relative(srcDir, resolve(id)).replace(/\\/g, '/'))
        .filter(file => !file.startsWith('..'))
      return code.replace(placeholder, () => JSON.stringify(JSON.stringify({ hash: hashSources(files), files })).slice(1, -1))
    },
  }],
})
