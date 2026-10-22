import Vue from '@vitejs/plugin-vue'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineProject } from 'vitest/config'

export default withCpuSlots(defineProject({
  root: import.meta.dirname,
  plugins: [Vue()],
  test: {
    name: 'qa-tools:node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**'],
    pool: 'forks',
    maxWorkers: 4,
    // Vitest refuses to run projects with different maxWorkers in one group, so a root run that
    // selects this project with any other one needs it in its own group.
    sequence: { groupOrder: 1 },
  },
}))
