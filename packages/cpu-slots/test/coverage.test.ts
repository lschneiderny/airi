import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('vitest config coverage', () => {
  it('routes every tracked vitest config through the CPU slot wrapper', () => {
    const files = execFileSync('git', ['ls-files', '*vitest*.config.*'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n')
      .map(file => file.trim())
      .filter(Boolean)

    expect(files.length).toBeGreaterThan(0)

    // The wrapper's own fixtures sit inside this package, so they import its source directly.
    const uncapped = files.filter((file) => {
      const source = readFileSync(join(repoRoot, file), 'utf8')
      return !source.includes('@proj-airi/cpu-slots/vitest')
        && (!file.startsWith('packages/cpu-slots/') || !/from '(?:\.\.\/)+src\/vitest'/.test(source))
    })
    expect(uncapped).toEqual([])
  })
})
