import process from 'node:process'

import { join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { compileCacheEnv } from './lib/compile-cache'
import { run } from './lib/exec'
import { repoRoot } from './lib/git'
import { testRunTurboArgs } from './test-run-plan'

/**
 * Runs every package's `test:run` through Turbo. Extra arguments go to Turbo, such as `--force` or `--filter=<package>`.
 */
async function main(): Promise<number> {
  const root = repoRoot(process.cwd())
  return await run(process.execPath, [join(root, 'node_modules/turbo/bin/turbo'), ...testRunTurboArgs, ...process.argv.slice(2)], {
    cwd: root,
    env: { ...process.env, ...compileCacheEnv(process.env, root) },
  })
}

main().then(code => process.exit(code), (error) => {
  console.error(`test:run broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  process.exit(1)
})
