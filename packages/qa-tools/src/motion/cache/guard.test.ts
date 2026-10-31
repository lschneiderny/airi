import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const qaTools = resolve(import.meta.dirname, '..', '..', '..')
const repoRoot = resolve(qaTools, '..', '..')
const skipped = new Set(['node_modules', '.temp', 'dist', '.git'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (skipped.has(entry.name))
      return []
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : [path]
  })
}

const isSource = (path: string) => /\.(?:ts|mts|vue)$/.test(path) && !path.endsWith('.test.ts')

/**
 * The cache key and closure cover what the worker loads through the module graph. A direct file read, or a glob
 * import, would make a gate input invisible to the closure, so a stale result could hit.
 */
const workerSide = [
  ...sourceFiles(join(repoRoot, 'packages/motion-driver-natural/src')),
  ...sourceFiles(join(repoRoot, 'packages/stage-ui-live2d/src/composables/live2d/natural-motion')),
  ...sourceFiles(join(qaTools, 'gates')),
  ...['src/motion/gate/trials.ts', 'src/motion/gate/options.ts', 'src/motion/validation/plan.ts', 'src/motion/validation/units.ts', 'src/motion/scenario-sink.ts'].map(path => join(qaTools, path)),
  ...sourceFiles(join(qaTools, 'src/motion/t1')),
].filter(isSource)

describe('cache closure guards', () => {
  it('finds the worker-side source set', () => {
    expect(workerSide.length).toBeGreaterThan(10)
    expect(workerSide.some(path => path.endsWith('emotion-score.ts'))).toBe(true)
  })

  it('reads no file directly on the worker side', () => {
    const offenders = workerSide.filter(path => /\breadFileSync\b|\breadFile\(/.test(readFileSync(path, 'utf8'))).map(path => relative(repoRoot, path))
    expect(offenders).toEqual([])
  })

  it('imports nothing through a glob anywhere in qa-tools', () => {
    const needle = `import.meta${'.'}glob`
    const offenders = sourceFiles(qaTools)
      .filter(path => /\.(?:ts|mts|vue|js|mjs)$/.test(path) && readFileSync(path, 'utf8').includes(needle))
      .map(path => relative(repoRoot, path))
    expect(offenders).toEqual([])
  })
})
