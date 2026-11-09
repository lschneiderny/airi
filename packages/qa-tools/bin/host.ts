import process from 'node:process'

import { resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { loadQaEnv } from '../src/env/load'
import { runHostCli } from '../src/host/run'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
loadQaEnv(repoRoot)

runHostCli(process.argv.slice(2), repoRoot).then((code) => {
  process.exitCode = code
}, (error) => {
  console.error(`qa-tools host: ${errorMessageFrom(error) ?? 'unexpected failure'}`)
  process.exitCode = 1
})
