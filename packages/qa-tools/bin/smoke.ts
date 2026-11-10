import process from 'node:process'

import { resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { acquire } from '@proj-airi/cpu-slots'

import { requireQaDisplaySession } from '../../../scripts/dev-tools/qa-display-guard'
import { loadQaEnv } from '../src/env/load'
import { parseSmokeArgs } from '../src/smoke/args'
import { runSmoke } from '../src/smoke/run'

const repoRoot = resolve(import.meta.dirname, '../../..')
loadQaEnv(repoRoot)

async function main(): Promise<number> {
  const options = parseSmokeArgs(requireQaDisplaySession('qa:smoke', process.argv.slice(2)), process.env.INIT_CWD ?? process.cwd())
  const controller = new AbortController()
  const stop = () => controller.abort(new Error('interrupted'))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  let lease: Awaited<ReturnType<typeof acquire>> | undefined
  try {
    lease = await acquire({
      class: 'live',
      command: 'qa:smoke',
      cwd: repoRoot,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60_000)]),
    })
    const result = await runSmoke(options, repoRoot, controller.signal, lease)
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
  process.stderr.write(`qa:smoke: ${errorMessageFrom(error) ?? 'invalid setup'}\n`)
  process.exitCode = 2
})
