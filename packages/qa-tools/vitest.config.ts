import Vue from '@vitejs/plugin-vue'

import { defineConfig } from 'vitest/config'

export default defineConfig({
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
      {
        // Gates run only through the qa-tools CLI, never from the root test run.
        extends: true,
        test: {
          name: 'gate',
          include: ['gates/**/*.gate.ts'],
          pool: 'forks',
          testTimeout: 0,
        },
      },
    ],
  },
})
