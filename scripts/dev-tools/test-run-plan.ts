import { errorMessageFrom } from '@moeru/std'

export interface TestRunSuite {
  label: string
  /** A fixed shell command line. It never includes caller input. */
  command: string
}

/** The suites `pnpm test:run` runs, in order. Each package script runs its own Vitest config. */
export const testRunSuites: readonly TestRunSuite[] = [
  { label: 'root vitest', command: 'pnpm exec vitest run' },
  { label: 'test-stage-tamagotchi:run', command: 'pnpm run test-stage-tamagotchi:run' },
  { label: 'test-stage-web:run', command: 'pnpm run test-stage-web:run' },
  { label: 'test-stage-pages:run', command: 'pnpm run test-stage-pages:run' },
  { label: 'test-ui:run', command: 'pnpm run test-ui:run' },
  { label: 'test-stage-ui-live2d:run', command: 'pnpm run test-stage-ui-live2d:run' },
  { label: 'test-model-driver-lipsync:run', command: 'pnpm run test-model-driver-lipsync:run' },
  { label: 'test-stage-ui-three:run', command: 'pnpm run test-stage-ui-three:run' },
  { label: 'test-stage-ui-mmd:run', command: 'pnpm run test-stage-ui-mmd:run' },
]

export interface SuiteResult {
  suite: TestRunSuite
  /** `null` when the process ended by a signal or could not start. */
  exitCode: number | null
  durationMs: number
  /** Set when the suite could not be started. */
  error?: string
}

/**
 * Runs every suite in order, including the suites after a failed one.
 *
 * Returns:
 * - One result per suite. A suite whose `runOne` rejects is recorded with its error, and the next suite still runs.
 */
export async function runSuites(suites: readonly TestRunSuite[], runOne: (suite: TestRunSuite) => Promise<number | null>, now: () => number = Date.now): Promise<SuiteResult[]> {
  const results: SuiteResult[] = []
  for (const suite of suites) {
    const started = now()
    try {
      const exitCode = await runOne(suite)
      results.push({ suite, exitCode, durationMs: now() - started })
    }
    catch (error) {
      results.push({ suite, exitCode: null, durationMs: now() - started, error: errorMessageFrom(error) ?? 'unknown spawn error' })
    }
  }
  return results
}

/** Exit 1 if and only if some suite did not exit 0. */
export function summarizeSuites(results: readonly SuiteResult[]): { exitCode: 0 | 1, lines: string[] } {
  const failed = results.filter(result => result.exitCode !== 0)
  const lines = ['test:run summary']
  for (const result of results) {
    const status = result.exitCode === 0 ? 'passed' : 'FAILED'
    const detail = result.error ? `could not start: ${result.error}` : `exit ${result.exitCode ?? 'signal'}`
    lines.push(`  ${status.padEnd(6)} ${result.suite.label.padEnd(30)} ${(result.durationMs / 1000).toFixed(1).padStart(7)}s  ${detail}`)
  }
  lines.push(`${results.length - failed.length}/${results.length} suites passed${failed.length ? `; failed: ${failed.map(result => result.suite.label).join(', ')}` : ''}`)
  return { exitCode: failed.length > 0 ? 1 : 0, lines }
}
