import type { BenchScenario } from '../src/bench/matrix'
import type { BenchModel } from '../src/bench/run'

import process from 'node:process'

import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { assertQaDisplaySession } from '../../../scripts/dev-tools/qa-display-guard'
import { takeAllowHostSession } from '../../../scripts/dev-tools/qa-display-plan'
import { BENCH_USAGE, parseBenchArgs } from '../src/bench/args'
import { benchHistoryPath } from '../src/bench/history'
import { BenchUsageError, estimateSeconds, planLaunches } from '../src/bench/matrix'
import { runBench } from '../src/bench/run'
import { modelFingerprint } from '../src/bench/summarize'
import { loadQaEnv } from '../src/env/load'
import { formatRunTimestamp } from '../src/evidence/run'
import { refuseIfWorktreeBusy } from '../src/session/app-session'
import { resolveRig, T3UsageError } from '../src/t3/args'

const repoRoot = resolve(import.meta.dirname, '../../..')
loadQaEnv(repoRoot)

/** Setup that refuses the bench before it takes a lease or writes anything; exit 2. */
class BenchSetupError extends Error {}

/** The model of a scenario's rig variable; the fingerprint file is the PMX or the rig's `*.model3.json`. */
function resolveModel(scenario: BenchScenario): BenchModel {
  if (scenario.model.kind === 'live2d') {
    try {
      const rig = resolveRig('forbooth', process.env)
      const { size, mtimeMs } = statSync(rig.model3)
      return { kind: 'live2d', zipFrom: rig.modelDir, fingerprint: modelFingerprint({ path: rig.model3, size, mtimeMs }) }
    }
    catch (error) {
      if (error instanceof T3UsageError)
        throw new BenchSetupError(`${scenario.id}: ${error.message}`)
      throw error
    }
  }
  const path = process.env[scenario.model.env]
  if (!path)
    throw new BenchSetupError(`${scenario.id}: ${scenario.model.env} is not set; point it at the MMD model (.pmx) in .env.qa`)
  if (!existsSync(path) || !statSync(path).isFile())
    throw new BenchSetupError(`${scenario.id}: ${scenario.model.env}=${path} is not a model file`)
  const { size, mtimeMs } = statSync(path)
  return { kind: 'mmd', zipFrom: dirname(path), fingerprint: modelFingerprint({ path, size, mtimeMs }) }
}

async function main(): Promise<number> {
  const { argv, allowHostSession } = takeAllowHostSession(process.argv.slice(2))
  const command = parseBenchArgs(argv, process.env.INIT_CWD ?? process.cwd())
  if (command.kind === 'help') {
    process.stdout.write(`${BENCH_USAGE}\n`)
    return 0
  }
  // Exits 2 outside a live qa:display session, before anything is written or a lease is taken.
  assertQaDisplaySession('qa:bench', allowHostSession)
  // Only Linux has the qa:display session that keeps the bench's windows off the user's desktop.
  if (process.platform !== 'linux')
    throw new BenchSetupError(`qa:bench runs on Linux only, not on ${process.platform}`)
  const models = new Map(command.scenarios.map(scenario => [scenario.model.env, resolveModel(scenario)]))
  await refuseIfWorktreeBusy(repoRoot)
  const launches = planLaunches(command.scenarios, command.runs)
  const out = command.out ?? resolve(repoRoot, '.temp/qa', `${formatRunTimestamp(new Date())}-bench`)
  const historyPath = benchHistoryPath({ platform: process.platform, env: process.env, homedir: homedir() })
  process.stderr.write(`qa:bench: ${launches.length} launches (${command.scenarios.map(scenario => scenario.id).join(', ')} x ${command.runs}), about ${Math.ceil(estimateSeconds(launches) / 60)} min plus CPU lease waits; runs in ${out}, history in ${historyPath}\n`)

  const controller = new AbortController()
  const stop = () => controller.abort(new Error('interrupted'))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    const result = await runBench({ repoRoot, out, launches, models, historyPath, selfPids: [process.pid, process.ppid], signal: controller.signal, log: line => process.stderr.write(`${line}\n`) })
    process.stdout.write(`${JSON.stringify({
      exitCode: result.exitCode,
      out,
      history: historyPath,
      runs: result.outcomes.map(outcome => ({
        scenario: outcome.scenario,
        run: outcome.run,
        valid: outcome.record?.valid ?? false,
        invalidReason: outcome.record?.invalidReason ?? null,
        error: outcome.error ?? null,
        fps: outcome.record?.metrics.fps ?? null,
        stageWindowCpuPct: outcome.record?.metrics.stageWindowCpuPct ?? null,
        stageWindowCpuMsPerFrame: outcome.record?.metrics.stageWindowCpuMsPerFrame ?? null,
      })),
    }, null, 2)}\n`)
    return result.exitCode
  }
  finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

main().then((code) => {
  process.exitCode = code
}, (error) => {
  const usage = error instanceof BenchUsageError
  process.stderr.write(`qa:bench: ${errorMessageFrom(error) ?? 'failed'}${usage ? `\n${BENCH_USAGE}` : ''}\n`)
  process.exitCode = usage || error instanceof BenchSetupError ? 2 : 1
})
