import type { TestProjectInlineConfiguration } from 'vitest/config'

import { domStorageExecArgv } from '../../vitest.dom-storage'
import { createStageUiProject } from './vitest.shared-project'

const shared = createStageUiProject()

export const stageUiNodeProject: TestProjectInlineConfiguration = {
  ...shared,
  test: {
    ...shared.test,
    name: 'node',
    execArgv: domStorageExecArgv,
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.browser.test.ts'],
    fileParallelism: false,
    hookTimeout: 20_000,
    maxWorkers: 1,
    testTimeout: 20_000,
  },
}
