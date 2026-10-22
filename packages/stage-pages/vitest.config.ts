import { resolve } from 'node:path'

import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import Info from 'unplugin-info/vite'
import VueRouter from 'vue-router/vite'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { sharedUnoConfig } from '../../uno.config'

export default withCpuSlots(defineConfig({
  root: import.meta.dirname,
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
