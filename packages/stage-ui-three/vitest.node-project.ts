import type { TestProjectInlineConfiguration } from 'vitest/config'

export const stageUiThreeNodeProject: TestProjectInlineConfiguration = {
  root: import.meta.dirname,
  test: {
    name: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.browser.test.ts', '**/node_modules/**', '**/.git/**'],
  },
}
