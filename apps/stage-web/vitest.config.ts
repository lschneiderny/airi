import Vue from '@vitejs/plugin-vue'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

import { stageWebBrowserProject } from './vitest.browser-project'

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
