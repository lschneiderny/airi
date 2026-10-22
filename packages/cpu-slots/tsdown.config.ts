import process from 'node:process'

import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import * as nodeFs from 'node:fs'

import { defineConfig } from 'tsdown'

const srcDir = resolve(import.meta.dirname, 'src')
const distDir = resolve(import.meta.dirname, 'dist')
// Vitest configs load dist/vitest.mjs at any moment, so the build never cleans or writes dist itself.
// It writes to a staging directory of its own process, and `build:done` renames each file over dist.
const stagingDir = resolve(import.meta.dirname, 'node_modules', '.cache', `dist-${process.pid}`)
const placeholder = '__CPU_SLOTS_BUILD_STAMP__'

// NOTICE:
// This repeats hashSources from src/stale-build.ts, because tsdown loads this config natively and Node
// cannot resolve the extension-less relative imports of src/. The shipped-dist test in
// test/vitest-wrapper.test.ts fails when the two drift apart.
// Removal condition: tsdown loads its config through a loader that resolves extension-less imports.
function hashSources(files: string[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort())
    hash.update(`${file}\0${nodeFs.readFileSync(join(srcDir, file), 'utf8').replace(/\r\n/g, '\n')}\0`)
  return hash.digest('hex')
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
