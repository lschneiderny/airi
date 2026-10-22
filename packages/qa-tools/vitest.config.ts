import process from 'node:process'

import { resolve } from 'node:path'

import Vue from '@vitejs/plugin-vue'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

import ClosureReporter from './src/motion/cache/closure-reporter'

export default withCpuSlots(defineConfig({
  root: import.meta.dirname,
  plugins: [Vue()],
  test: {
    ...(process.env.QA_RUN_DIR
      ? { reporters: ['default', new ClosureReporter(resolve(import.meta.dirname, '../..'), process.env.QA_RUN_DIR)] }
      : {}),
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
          include: process.env.QA_RUN_DIR ? ['gates/**/*.gate.ts'] : [],
          pool: 'forks',
          testTimeout: 0,
        },
      },
    ],
  },
}))
