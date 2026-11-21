import type { BenchScenarioId } from '../bench/matrix'

import { BENCH_V1 } from '../bench/matrix'

const allScenarios = BENCH_V1.map(scenario => scenario.id)

/**
 * Source paths whose changes can move per-frame cost, each with the bench scenarios that measure it. The perf tracker
 * picks the subjects it benches from these rows, and `pnpm verify` lists its perf follow-up from them.
 */
export const renderLoopPaths: readonly { re: RegExp, scenarios: readonly BenchScenarioId[] }[] = [
  { re: /^packages\/(?:stage-ui-mmd|motion-driver-humanoid)\/src\//, scenarios: ['mmd-idle', 'mmd-talk'] },
  { re: /^packages\/(?:stage-ui-live2d|model-driver-magic-live2d|motion-driver-magic)\/src\//, scenarios: ['live2d-idle'] },
  { re: /^packages\/(?:motion-driver-natural|character-mind|model-driver-lipsync|stage-ui-three)\/src\//, scenarios: allScenarios },
  { re: /^packages\/stage-shared\/src\/perf\//, scenarios: allScenarios },
  { re: /^apps\/stage-tamagotchi\/src\/(?:main\/services\/airi\/perf-recording|renderer\/bridges\/perf-recording)/, scenarios: allScenarios },
]

const testFile = /\.(?:browser\.)?test\.[cm]?[jt]sx?$/

/** The bench scenarios that measure the changed paths, in `BENCH_V1` order; test files count for none. */
export function scenariosForPaths(paths: readonly string[]): BenchScenarioId[] {
  const matched = new Set(paths
    .filter(path => !testFile.test(path))
    .flatMap(path => renderLoopPaths.filter(row => row.re.test(path)).flatMap(row => row.scenarios)))
  return allScenarios.filter(id => matched.has(id))
}

export function touchesRenderLoop(paths: readonly string[]): boolean {
  return scenariosForPaths(paths).length > 0
}
