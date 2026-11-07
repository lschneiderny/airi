import process from 'node:process'

import { resolve } from 'node:path'

import { loadQaEnv } from '../src/env/load'
import { runStageCli } from '../src/stage/cli'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
loadQaEnv(repoRoot)

void runStageCli(process.argv.slice(2), {
  repoRoot,
  // pnpm runs package scripts in the package directory; INIT_CWD is where the user typed the command.
  cwd: process.env.INIT_CWD ?? process.cwd(),
  selfPids: [process.pid, process.ppid],
}).then((code) => {
  process.exitCode = code
})
