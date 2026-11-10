import type { TestProjectInlineConfiguration } from 'vitest/config'

import { resolve } from 'node:path'

import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import Info from 'unplugin-info/vite'
import VueRouter from 'vue-router/vite'

import { playwright } from '@vitest/browser-playwright'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { sharedUnoConfig } from '../../uno.config.ts'

export const stagePagesBrowserProject: TestProjectInlineConfiguration = {
  root: import.meta.dirname,
  // Follower-window tests must not reload while their election is starting.
  optimizeDeps: { include: ['pinia-plugin-synced'] },
  plugins: [
    Info(),
    Vue(),
    VueRouter({
      extensions: ['.vue'],
      dts: false,
      routesFolder: resolve(import.meta.dirname, 'src', 'pages'),
      exclude: ['**/components/**', '**/*.test.ts'],
    }),
    UnoCSS({
      ...sharedUnoConfig(),
      configFile: false,
      content: {
        // NOTICE:
        // Keep these globs root-relative. On Windows, `import.meta.dirname` has
        // backslashes that tinyglobby reads as escapes, matching zero files.
        // Source: @unocss/vite setupContentExtractor.
        // Removal condition: none; absolute patterns would reintroduce it.
        filesystem: [
          'src/**/*.vue',
          '../stage-ui/src/**/*.vue',
          '../ui/src/**/*.vue',
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.browser.test.ts'],
    // Module imports take about 60 s per run, leaving fresh-checkout renders slower than the
    // default 1 s poll. Use Playwright's 5 s assertion timeout; missing elements still fail.
    expect: { poll: { timeout: 5_000 } },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [
        { browser: 'chromium' },
      ],
    },
  },
}
