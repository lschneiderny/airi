import process from 'node:process'

import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { expect, it } from 'vitest'

const exec = promisify(execFile)

it('classifies the repository node root as test when loading its real projects', async () => {
  const root = resolve(import.meta.dirname, '../../..')
  const store = mkdtempSync(resolve(tmpdir(), 'vitest-node-root-'))
  try {
    const result = await exec(process.execPath, [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'list',
      '--filesOnly',
      '--project',
      'dev-tools',
    ], {
      cwd: root,
      env: {
        ...process.env,
        CI: '',
        AIRI_CPU_SLOTS: '',
        AIRI_CPU_SLOTS_DIR: store,
        AIRI_CPU_BUDGET: '12',
        AIRI_CPU_LEASE: '',
        AIRI_CPU_GRANT: '',
        AIRI_CPU_CLASS: '',
      },
      timeout: 60_000,
    })
    expect(result.stderr).toMatch(/cpu-slots: granted \d+ \(test\)/)
  }
  finally {
    rmSync(store, { recursive: true, force: true })
  }
}, 70_000)
