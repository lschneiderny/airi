import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { modelDriverLipsyncBrowserProject } from './vitest.browser-project.ts'

export default withCpuSlots(defineConfig({
  root: import.meta.dirname,
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      modelDriverLipsyncBrowserProject,
    ],
  },
}))
