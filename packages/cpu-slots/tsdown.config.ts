import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { defineConfig } from 'tsdown'

const srcDir = resolve(import.meta.dirname, 'src')
const placeholder = '__CPU_SLOTS_BUILD_STAMP__'

// NOTICE:
// This repeats hashSources from src/stale-build.ts, because tsdown loads this config natively and Node
// cannot resolve the extension-less relative imports of src/. The shipped-dist test in
// test/vitest-wrapper.test.ts fails when the two drift apart.
// Removal condition: tsdown loads its config through a loader that resolves extension-less imports.
function hashSources(files: string[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort())
    hash.update(`${file}\0${readFileSync(join(srcDir, file), 'utf8').replace(/\r\n/g, '\n')}\0`)
  return hash.digest('hex')
}

export default defineConfig({
  entry: ['src/vitest.ts'],
  dts: true,
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
