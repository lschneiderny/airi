import { resolve } from 'node:path'

import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import Info from 'unplugin-info/vite'
import VueRouter from 'vue-router/vite'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { sharedUnoConfig } from '../../uno.config.ts'

export default defineConfig({
  root: import.meta.dirname,
  // Follower-window tests must not reload while their election is starting. stage-pages does not depend on
  // pinia-plugin-synced itself, so the include names it through stage-ui; a bare name fails to resolve and is skipped.
  optimizeDeps: { include: ['@proj-airi/stage-ui > pinia-plugin-synced'] },
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
      // The Voiceprint page records from the microphone. Chromium then uses a fake device without a permission prompt.
      provider: playwright({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } }),
      instances: [
        { browser: 'chromium' },
      ],
    },
  },
})
