import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import process, { env, pid, ppid, stderr, stdout } from 'node:process'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { acquire, CpuSlotsError } from '@proj-airi/cpu-slots'

import { loadT3Scenario, parseT3Args, resolveRig, t3RigCatalogs, t3Usage, T3UsageError } from './args'
import { runT3 } from './run-t3'

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'fixtures')

/** Longest T3 waits for its exclusive CPU lease; other worktrees' work can hold the budget that long. */
export const T3_LEASE_WAIT_MS = 30 * 60_000
/** Exit code when the exclusive lease does not arrive in time. 0, 1, 2 and 130 are taken. */
export const T3_LEASE_TIMEOUT_EXIT = 3

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
    const timeout = AbortSignal.timeout(T3_LEASE_WAIT_MS)
    try {
      // Exclusive: a rendered run measures frames, so nothing else may compete. `--keep-open` holds the lease until teardown.
      lease = await acquire({ class: 'exclusive', command: `qa:motion t3 ${argv.join(' ')}`, cwd: repoRoot, signal: AbortSignal.any([controller.signal, timeout]) })
    }
    catch (error) {
      if (controller.signal.aborted)
        return 130
      if (timeout.aborted) {
        stderr.write(`qa-tools t3: no exclusive CPU lease within ${T3_LEASE_WAIT_MS / 60_000} min; run \`pnpm slots status\` to see who holds the budget\n`)
        return T3_LEASE_TIMEOUT_EXIT
      }
      if (error instanceof CpuSlotsError && error.code === 'exclusive-under-shared') {
        stderr.write(`qa-tools t3: T3 needs an exclusive CPU lease, but it runs under the shared lease ${env.AIRI_CPU_LEASE ?? ''} it inherited; run qa:motion t3 directly, not from \`pnpm slots run\` or another leased command\n`)
        return 2
      }
      throw error
    }
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
