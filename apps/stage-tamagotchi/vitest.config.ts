import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { createStageTamagotchiProject, stageTamagotchiBrowserProject } from './vitest.browser-project.ts'

const shared = createStageTamagotchiProject()

export default withCpuSlots(defineConfig({
  ...shared,
  test: {
    ...shared.test,
    projects: [{
      extends: true,
      test: {
        name: 'node',
        include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
        exclude: ['src/**/*.browser.test.ts', '**/node_modules/**', '**/.git/**'],
        fileParallelism: false,
        maxWorkers: 1,
        setupFiles: ['../../scripts/dev-tools/vitest-isolate-host-session.ts'],
      },
    }, stageTamagotchiBrowserProject],
  },
}))
