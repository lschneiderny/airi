import Vue from '@vitejs/plugin-vue'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { stageWebBrowserProject } from './vitest.browser-project.ts'

export default withCpuSlots(defineConfig({
  plugins: [Vue()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      stageWebBrowserProject,
    ],
  },
}))
