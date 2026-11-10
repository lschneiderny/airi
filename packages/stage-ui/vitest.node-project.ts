import type { TestProjectInlineConfiguration } from 'vitest/config'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { domStorageExecArgv } from '../../vitest.dom-storage.ts'
// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { createStageUiProject } from './vitest.shared-project.ts'

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
