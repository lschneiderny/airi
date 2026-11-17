import Vue from '@vitejs/plugin-vue'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

export default withCpuSlots(defineConfig({
  root: import.meta.dirname,
  plugins: [Vue()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/.git/**'],
          pool: 'forks',
          maxWorkers: 4,
        },
      },
    ],
  },
}))
