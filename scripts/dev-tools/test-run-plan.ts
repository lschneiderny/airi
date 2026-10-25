import { errorMessageFrom } from '@moeru/std'

export interface TestRunSuite {
  label: string
  /** A fixed shell command line. It never includes caller input. */
  command: string
}

/**
 * The command that brings every built workspace package up to date. Tests import `dist` output such as the i18n
 * locales, and a pull or merge that changes package sources leaves `dist` stale while the lockfile, and so the
 * install `postinstall` build, stays unchanged. Turbo skips a package whose input hash is unchanged, so an up-to-date
 * tree costs seconds.
 */
export const buildWorkspacePackagesCommand = 'pnpm run build:packages'

/** The suites `pnpm test:run` runs, in order. Each package script runs its own Vitest config. */
export const testRunSuites: readonly TestRunSuite[] = [
  { label: 'rebuild stale packages', command: buildWorkspacePackagesCommand },
  { label: 'root vitest', command: 'pnpm exec vitest run' },
  { label: 'test-stage-tamagotchi:run', command: 'pnpm run test-stage-tamagotchi:run' },
  { label: 'test-stage-web:run', command: 'pnpm run test-stage-web:run' },
  { label: 'test-stage-pages:run', command: 'pnpm run test-stage-pages:run' },
  { label: 'test-ui:run', command: 'pnpm run test-ui:run' },
  { label: 'test-stage-ui-live2d:run', command: 'pnpm run test-stage-ui-live2d:run' },
  { label: 'test-model-driver-lipsync:run', command: 'pnpm run test-model-driver-lipsync:run' },
  { label: 'test-stage-ui-three:run', command: 'pnpm run test-stage-ui-three:run' },
  { label: 'test-stage-ui-mmd:run', command: 'pnpm run test-stage-ui-mmd:run' },
  { label: 'test-audio-browser:run', command: 'pnpm run test-audio-browser:run' },
  { label: 'test-stage-tamagotchi-kirie-browser:run', command: 'pnpm run test-stage-tamagotchi-kirie-browser:run' },
]

export interface VitestConfigCoverage {
  /** `root` is a project of the root `vitest.config.ts`. Any other entry is a `pnpm test:run` package script. */
  runBy: string[]
  /** Why no runner runs the config, or what part of it runs. */
  note?: string
}

/**
 * Every tracked Vitest config and the runner that runs it. A config with an empty `runBy` is deliberately excluded and
 * its `note` says why. The test in `test-run-plan.test.ts` fails when a tracked config is missing here, so a new package
 * cannot have tests that no runner runs.
 */
export const vitestConfigCoverage: Readonly<Record<string, VitestConfigCoverage>> = {
  'apps/stage-tamagotchi-kirie/vitest.config.ts': { runBy: ['test-stage-tamagotchi-kirie-browser:run'], note: 'its node project runs through vitest.node.config.ts' },
  'apps/stage-tamagotchi-kirie/vitest.node.config.ts': { runBy: ['root'] },
  'apps/stage-tamagotchi/vitest.config.ts': { runBy: ['test-stage-tamagotchi:run'] },
  'apps/stage-tamagotchi/vitest.node.config.ts': { runBy: ['root'] },
  'apps/stage-web/vitest.config.ts': { runBy: ['test-stage-web:run'], note: 'its unit project matches no file' },
  'apps/ui-server-auth/vitest.config.ts': { runBy: ['root'] },
  'integrations/minecraft/vitest.config.ts': { runBy: ['root'] },
  'integrations/telegram-bot/vitest.config.ts': { runBy: ['root'], note: 'the root config holds an inline project' },
  'packages/audio/vitest.config.ts': { runBy: ['root', 'test-audio-browser:run'], note: 'the root config holds an inline node project' },
  'packages/better-ws/vitest.config.ts': { runBy: ['root'] },
  'packages/cap-vite/vitest.config.ts': { runBy: ['root'] },
  'packages/ccc/vitest.config.ts': { runBy: ['root'] },
  'packages/core-agent/vitest.config.ts': { runBy: ['root'] },
  'packages/cpu-slots/test/fixtures/vitest-wrapper/vitest.bundled-project.config.ts': { runBy: [], note: 'A fixture that the cpu-slots tests feed to Vitest. It holds no suite.' },
  'packages/i18n/vitest.config.ts': { runBy: ['root'] },
  'packages/input-gamepad-vueuse/vitest.config.ts': { runBy: ['root'] },
  'packages/input-gamepad/vitest.config.ts': { runBy: ['root'] },
  'packages/input-playstation-dualsense-5/vitest.config.ts': { runBy: ['root'] },
  'packages/model-driver-lipsync/vitest.config.ts': { runBy: ['test-model-driver-lipsync:run'] },
  'packages/model-driver-lipsync/vitest.node.config.ts': { runBy: ['root'] },
  'packages/model-driver-magic-live2d/vitest.config.ts': { runBy: ['root'] },
  'packages/motion-driver-magic/vitest.config.ts': { runBy: ['root'] },
  'packages/pipelines-audio/vitest.config.ts': { runBy: ['root'] },
  'packages/plugin-protocol/vitest.config.ts': { runBy: ['root'] },
  'packages/plugin-sdk-tamagotchi/vitest.config.ts': { runBy: ['root'] },
  'packages/plugin-sdk/vitest.config.ts': { runBy: ['root'] },
  'packages/provider-inference/vitest.config.ts': { runBy: ['root'] },
  'packages/qa-tools/spikes/t2/vitest.browser.config.ts': { runBy: [], note: 'A spike harness that needs a Live2D rig folder and a Cubism core through environment variables. It runs by hand.' },
  'packages/qa-tools/vitest.config.ts': { runBy: [], note: 'Its node project runs through vitest.node.config.ts. Its gate project runs only through the qa-tools gate CLI and needs a rig and a Cubism core.' },
  'packages/qa-tools/vitest.node.config.ts': { runBy: ['root'] },
  'packages/scenarios-stage-tamagotchi-browser/vitest.config.ts': { runBy: ['root'] },
  'packages/scenarios-stage-tamagotchi-electron/vitest.config.ts': { runBy: ['root'] },
  'packages/server-runtime/vitest.config.ts': { runBy: ['root'] },
  'packages/server-sdk/vitest.config.ts': { runBy: ['root'] },
  'packages/stage-layouts/vitest.config.ts': { runBy: ['root'] },
  'packages/stage-pages/vitest.config.ts': { runBy: ['test-stage-pages:run'] },
  'packages/stage-shared/vitest.config.ts': { runBy: ['root'] },
  'packages/stage-ui-live2d/vitest.config.ts': { runBy: ['test-stage-ui-live2d:run'] },
  'packages/stage-ui-live2d/vitest.node.config.ts': { runBy: ['root'] },
  'packages/stage-ui-mmd/vitest.config.ts': { runBy: ['root', 'test-stage-ui-mmd:run'], note: 'the root config holds an inline node project' },
  'packages/stage-ui-tachie/vitest.config.ts': { runBy: ['root'] },
  'packages/stage-ui-three/vitest.config.ts': { runBy: ['test-stage-ui-three:run'] },
  'packages/stage-ui-three/vitest.node.config.ts': { runBy: ['root'] },
  'packages/stage-ui/vitest.config.ts': { runBy: ['test-ui:run'] },
  'packages/testing-audio/vitest.config.ts': { runBy: ['root'], note: 'only the unit project, as an inline root project. The fakemic projects need the built stage-web and Electron apps and a microphone runtime, so they run only on demand through the package script.' },
  'packages/vite-plugin-sherpaw/vitest.config.ts': { runBy: ['root'] },
  'packages/vitest-plugin-fakemic/vitest.config.ts': { runBy: ['root'] },
  'server/apps/api/vitest.config.ts': { runBy: ['root'] },
  'server/apps/auth/vitest.config.ts': { runBy: ['root'] },
  'services/computer-use-mcp/vitest.config.ts': { runBy: ['root'] },
}

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
