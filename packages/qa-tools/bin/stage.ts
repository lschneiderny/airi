import process from 'node:process'

import { resolve } from 'node:path'

import { requireQaDisplaySession } from '../../../scripts/dev-tools/qa-display-guard'
import { loadQaEnv } from '../src/env/load'
import { runStageCli } from '../src/stage/cli'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
loadQaEnv(repoRoot)

const [command, ...rest] = process.argv.slice(2)
// `handoff` launches the app itself, so on Linux it runs only inside a QA display session, like `qa:smoke`.
const argv = command === 'handoff' ? [command, ...requireQaDisplaySession('qa:stage handoff', rest)] : process.argv.slice(2)
const interrupt = new AbortController()
const stop = () => interrupt.abort(new Error('interrupted'))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

void runStageCli(argv, {
  repoRoot,
  // pnpm runs package scripts in the package directory; INIT_CWD is where the user typed the command.
  cwd: process.env.INIT_CWD ?? process.cwd(),
  selfPids: [process.pid, process.ppid],
  signal: interrupt.signal,
}).then((code) => {
  process.exitCode = interrupt.signal.aborted ? 130 : code
}).finally(() => {
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
})
