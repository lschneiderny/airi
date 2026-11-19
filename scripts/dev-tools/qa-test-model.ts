import process from 'node:process'

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { loadQaEnv } from '../../packages/qa-tools/src/env/load'
import { compileCacheEnv } from './lib/compile-cache'
import { groupByVitestConfig, listGatedTestFiles, planGatedRun, qaGatedFiles, skippedGatedNotice } from './lib/gated-tests'
import { repoRoot } from './lib/git'

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    console.error('Usage: pnpm qa:test:model\n\nRuns the test files gated on AIRI_QA_* variables that are set, with .env.qa loaded.')
    return 2
  }
  const root = repoRoot(process.cwd())
  const { file: envFile } = loadQaEnv(root)
  const plan = planGatedRun(qaGatedFiles(listGatedTestFiles(root)), process.env, envFile, existsSync)
  if (!plan.ok) {
    console.error(`qa:test:model: ${plan.message}`)
    return 2
  }
  const files = plan.run
  const variables = [...new Set(files.flatMap(file => file.variables))]
  console.info(`qa:test:model: ${files.length} file(s) gated on ${variables.join(', ')}\n${files.map(file => `  ${file.file}`).join('\n')}`)
  const skipped = skippedGatedNotice(plan.skipped, process.env)
  if (skipped)
    console.info(`qa:test:model: ${skipped}`)
  // Each package runs its own files, directly and not through Turbo, so no result is cached and the variables reach
  // the tests.
  let exitCode = 0
  for (const [directory, packageFiles] of groupByVitestConfig(files.map(file => file.file), candidate => existsSync(join(root, candidate, 'vitest.config.ts')))) {
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...packageFiles], {
        cwd: join(root, directory),
        env: { ...process.env, ...compileCacheEnv(process.env, root) },
        stdio: 'inherit',
      })
      child.once('error', reject)
      child.once('close', code => resolve(code ?? 1))
    })
    exitCode ||= code
  }
  return exitCode
}

try {
  process.exitCode = await main()
}
catch (error) {
  console.error(`qa:test:model broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  process.exitCode = 1
}
