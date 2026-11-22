import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader resolves a relative import only with its extension.
import { domStorageExecArgv } from '../../vitest.dom-storage.ts'

export default defineConfig({
  root: import.meta.dirname,
  test: {
    projects: [
      {
        test: {
          name: 'node',
          execArgv: domStorageExecArgv,
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } }),
            instances: [
              { browser: 'chromium' },
            ],
          },
        },
      },
    ],
  },
})
