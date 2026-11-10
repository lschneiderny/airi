import type { TestProjectInlineConfiguration } from 'vitest/config'

export const providerInferenceNodeProject: TestProjectInlineConfiguration = {
  root: import.meta.dirname,
  test: {
    name: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.browser.test.ts'],
  },
}
