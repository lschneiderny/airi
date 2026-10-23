import Vue from '@vitejs/plugin-vue'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'

import stageWebConfig from './vite.config'

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
      mergeConfig(stageWebConfig, defineConfig({
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          // NOTICE:
          // Run the browser files one after another. Chromium renders every Live2D and VRM canvas in software WebGL,
          // so concurrent files share the CPU and the polaroid test (2 s alone) passed the 15 s test timeout at 17 s.
          // Source: `pnpm test-stage-web:run` with parallel files; the same test passes 3 of 3 alone.
          // Removal condition: the browser pool gives each file its own GPU or the suite stops sharing a renderer.
          fileParallelism: false,
          setupFiles: ['./src/test/setup-live2d.browser.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [
              { browser: 'chromium' },
            ],
          },
        },
      })),
    ],
  },
}))
