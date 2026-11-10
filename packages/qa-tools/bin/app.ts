import process from 'node:process'

import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { acquire } from '@proj-airi/cpu-slots'

import { assertQaDisplaySession } from '../../../scripts/dev-tools/qa-display-guard'
import { takeAllowHostSession } from '../../../scripts/dev-tools/qa-display-plan'
import { parseAppArgs } from '../src/app/args'
import { buildPlan } from '../src/app/plan'
import { runApp } from '../src/app/run'
import { loadQaEnv } from '../src/env/load'
import { formatRunTimestamp } from '../src/evidence/run'

const repoRoot = resolve(import.meta.dirname, '../../..')
loadQaEnv(repoRoot)

async function main(): Promise<number> {
  const { argv, allowHostSession } = takeAllowHostSession(process.argv.slice(2))
  const options = parseAppArgs(argv, process.env.INIT_CWD ?? process.cwd())
  if (options.dryRun) {
    const runDir = options.out ?? resolve(repoRoot, '.temp/qa', `${formatRunTimestamp(new Date())}-app-experience`)
    process.stdout.write(`${JSON.stringify(buildPlan(options, runDir))}\n`)
    return 0
  }
  assertQaDisplaySession('qa:app', allowHostSession)
  statSync(options.model)
  const controller = new AbortController()
  const stop = () => controller.abort(new Error('interrupted'))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  let lease: Awaited<ReturnType<typeof acquire>> | undefined
  try {
    lease = await acquire({
      class: 'live',
      command: `qa:app run --model ${options.model}`,
      cwd: repoRoot,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60_000)]),
    })
    const result = await runApp(options, repoRoot, controller.signal, lease)
    process.stdout.write(`${JSON.stringify(result.summary)}\n`)
    return result.exitCode
  }
  catch (error) {
    if (controller.signal.aborted)
      return 130
    throw error
  }
  finally {
    lease?.release()
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

main().then((code) => {
  process.exitCode = code
}, (error) => {
  process.stderr.write(`qa:app: ${errorMessageFrom(error) ?? 'invalid setup'}\n`)
  process.exitCode = 2
})
