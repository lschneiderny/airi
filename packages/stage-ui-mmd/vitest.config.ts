import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

import { stageUiMmdBrowserProject } from './vitest.browser-project'

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
      stageUiMmdBrowserProject,
    ],
  },
}))
