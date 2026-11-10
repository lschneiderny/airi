import type { TestProjectInlineConfiguration } from 'vitest/config'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import stageWebConfig from './vite.config.ts'

export const stageWebBrowserProject: TestProjectInlineConfiguration = mergeConfig(stageWebConfig, defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'browser',
    include: ['src/**/*.browser.test.ts'],
    // NOTICE:
    // Serialize files because software WebGL contention makes the polaroid test exceed its timeout.
    // Source: pnpm test-stage-web:run; polaroid takes 17 s parallel, 2 s alone.
    // Removal condition: browser files have separate GPUs or stop sharing a renderer.
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
}))
