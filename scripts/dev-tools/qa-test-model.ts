import process from 'node:process'

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { loadQaEnv } from '../../packages/qa-tools/src/env/load'
import { compileCacheEnv } from './lib/compile-cache'
import { gatedRunRefusal, listGatedTestFiles, qaGatedFiles } from './lib/gated-tests'
import { repoRoot } from './lib/git'

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    console.error('Usage: pnpm qa:test:model\n\nRuns every test file gated on AIRI_QA_* variables, with .env.qa loaded.')
    return 2
  }
  const root = repoRoot(process.cwd())
  const { file: envFile } = loadQaEnv(root)
  const files = qaGatedFiles(listGatedTestFiles(root))
  const refusal = gatedRunRefusal(files, process.env, envFile, existsSync)
  if (refusal) {
    console.error(`qa:test:model: ${refusal}`)
    return 2
  }
  const variables = [...new Set(files.flatMap(file => file.variables))]
  console.info(`qa:test:model: ${files.length} file(s) gated on ${variables.join(', ')}\n${files.map(file => `  ${file.file}`).join('\n')}`)
  // The root Vitest config takes its CPU slots through withCpuSlots, like every other test run.
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts', ...files.map(file => file.file)], {
      cwd: root,
      env: { ...process.env, ...compileCacheEnv(process.env, root) },
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', code => resolve(code ?? 1))
  })
}

try {
  process.exitCode = await main()
}
catch (error) {
  console.error(`qa:test:model broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  process.exitCode = 1
}
