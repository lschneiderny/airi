import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import process, { env, pid, ppid, stderr, stdout } from 'node:process'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { acquire } from '@proj-airi/cpu-slots'

import { loadT3Scenario, parseT3Args, resolveRig, t3RigCatalogs, t3Usage, T3UsageError } from './args'
import { runT3 } from './run-t3'

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'fixtures')

/** `qa:motion t3 ...`: validates the arguments and the rig before launching, runs one T3 scenario, and returns the exit code. */
export async function runT3Cli(argv: readonly string[], repoRoot: string): Promise<number> {
  let prepared: { rig: ReturnType<typeof resolveRig>, scenario: ReturnType<typeof loadT3Scenario>, catalog: CatalogEntry[], keepOpen: boolean }
  try {
    const options = parseT3Args(argv)
    prepared = {
      rig: resolveRig(options.rig, env),
      scenario: loadT3Scenario(options.scenario, { fixturesDir: resolve(fixturesDir, 'scenarios'), cwd: process.cwd() }),
      catalog: JSON.parse(readFileSync(resolve(fixturesDir, t3RigCatalogs[options.rig]), 'utf8')) as CatalogEntry[],
      keepOpen: options.keepOpen,
    }
  }
  catch (error) {
    if (error instanceof T3UsageError) {
      stderr.write(`qa-tools motion t3: ${error.message}\n\n${t3Usage}`)
      return 2
    }
    throw error
  }

  const controller = new AbortController()
  let interrupts = 0
  const onInterrupt = (signal: string) => {
    interrupts += 1
    if (interrupts === 1) {
      stderr.write(`qa-tools t3: ${signal} received; stopping and tearing down\n`)
      controller.abort(new Error(`${signal} received`))
    }
    else {
      // Teardown must finish, so later interrupts are reported and ignored.
      stderr.write(`qa-tools t3: ${signal} again (${interrupts}); teardown is still running\n`)
    }
  }
  const signals = ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const
  const listeners = signals.map(signal => [signal, () => onInterrupt(signal)] as const)
  for (const [signal, listener] of listeners)
    process.on(signal, listener)

  let lease: Awaited<ReturnType<typeof acquire>> | undefined
  try {
    // Exclusive: a rendered run measures frames, so nothing else may compete. `--keep-open` holds the lease until teardown.
    lease = await acquire({ class: 'exclusive', command: `qa:motion t3 ${argv.join(' ')}`, cwd: repoRoot, signal: controller.signal }).catch((error: unknown) => {
      if (controller.signal.aborted)
        return undefined
      throw error
    })
    if (!lease)
      return 130
    const result = await runT3({
      repoRoot,
      rig: prepared.rig,
      scenario: prepared.scenario.scenario,
      scenarioSource: prepared.scenario.source,
      catalog: prepared.catalog,
      keepOpen: prepared.keepOpen,
      signal: controller.signal,
      log: line => stderr.write(`${line}\n`),
      selfPids: [pid, ppid],
    })
    stdout.write(`${JSON.stringify({ exitCode: result.exitCode, summary: result.summary, runDir: result.runDir ?? null }, null, 2)}\n`)
    return result.exitCode
  }
  finally {
    lease?.release()
    for (const [signal, listener] of listeners)
      process.off(signal, listener)
  }
}
