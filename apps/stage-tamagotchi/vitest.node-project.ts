import type { TestProjectInlineConfiguration } from 'vitest/config'

import { cwd } from 'node:process'

import vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'

import { loadEnv } from 'vite'

export const stageTamagotchiNodeProject: TestProjectInlineConfiguration = {
  root: import.meta.dirname,
  plugins: [Info(), vue()],
  test: {
    name: 'node',
    env: loadEnv('test', cwd(), ''),
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['src/**/*.browser.test.ts', '**/node_modules/**', '**/.git/**'],
    fileParallelism: false,
    maxWorkers: 1,
    setupFiles: ['../../scripts/dev-tools/vitest-isolate-host-session.ts'],
  },
}
