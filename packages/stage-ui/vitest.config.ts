import { join } from 'node:path'
import { cwd } from 'node:process'

import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import Info from 'unplugin-info/vite'
import VueRouter from 'vue-router/vite'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { playwright } from '@vitest/browser-playwright'
import { mergeConfigs } from 'unocss'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

import { sharedUnoConfig } from '../../uno.config'
import { domStorageExecArgv } from '../../vitest.dom-storage'

// Vitest's default browser viewport, stated explicitly because the Playwright page below must match it.
const testViewport = { width: 414, height: 896 }

export default withCpuSlots(defineConfig({
  root: import.meta.dirname,
  // Shared settings pages import these optional UI dependencies through the
  // component barrel, and test Workers import the eventa Worker adapter.
  // Bundle them before a browser test starts to avoid HMR.
  optimizeDeps: {
    include: [
      '@moeru/eventa/adapters/webworkers',
      '@moeru/eventa/adapters/webworkers/worker',
      '@moeru/std',
      '@proj-airi/stage-ui-live2d > @pixi/math',
      '@vueuse/core',
      'embla-carousel-vue',
      'html2canvas',
      'node-vibrant/browser',
      'reka-ui',
      'vaul-vue',
      'vue',
      'vue-i18n',
    ],
  },
  plugins: [
    Info(),
    // Use the app's route-block transform when browser tests mount shared pages.
    VueRouter({ routesFolder: [], dts: false }),
    Vue(),
    // `pnpm verify` starts Vitest from the repository root, where the icon collections of this package do not resolve.
    UnoCSS(mergeConfigs([sharedUnoConfig({ iconCollectionsPath: import.meta.dirname }), {
      // Browser tests use product styles, not Histoire's hover-preview variants.
      configFile: false,
      // Vitest loads components after the stylesheet. Scan their source before
      // the initial CSS response instead of relying on Vite's HMR updates.
      content: {
        // NOTICE:
        // Keep these globs root-relative. On Windows, `import.meta.dirname` has
        // backslashes that tinyglobby reads as escapes, matching zero files.
        // Source: @unocss/vite setupContentExtractor.
        // Removal condition: none; absolute patterns would reintroduce it.
        filesystem: [
          'src/**/*.vue',
          '../ui/src/**/*.vue',
        ],
      },
    }])),
  ],
  test: {
    env: loadEnv('test', cwd(), ''),
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          execArgv: domStorageExecArgv,
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          fileParallelism: false,
          hookTimeout: 20_000,
          maxWorkers: 1,
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          exclude: ['**/node_modules/**'],
          browser: {
            enabled: true,
            headless: true,
            testerHtmlPath: './src/test/tester.html',
            viewport: testViewport,
            provider: playwright({
              // NOTICE:
              // Visual baselines need unscaled screenshots. Headless Vitest scales the iframe to fit the
              // 1280x720 Playwright page, so a 414x896 iframe renders at 0.8x.
              // Source: setIframeViewport in @vitest/browser orchestrator, createContext in @vitest/browser-playwright.
              // Removal condition: Vitest sizes the headless page to the browser viewport itself.
              contextOptions: { viewport: testViewport },
              launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
            }),
            instances: [
              { browser: 'chromium' },
            ],
            // Visual baselines (`*.visual.browser.test.ts`). The package README describes the workflow.
            expect: {
              toMatchScreenshot: {
                comparatorName: 'pixelmatch',
                comparatorOptions: {
                  // A pixel counts as changed when its YIQ color distance exceeds 0.1 (pixelmatch's default). This
                  // absorbs rounding in alpha blending and backdrop blur between Chromium builds.
                  threshold: 0.1,
                  // Anti-aliased glyph and border edges are not counted (pixelmatch's default). They move between
                  // font rasterizer builds and hinting settings without any style change.
                  includeAA: false,
                  // Up to 0.1% of the frame (about 300 pixels of 360x800) may also differ, for stray edge noise.
                  // A color, size, or spacing change of a covered control exceeds it. Changes confined to
                  // anti-aliased edges, such as a smaller radius on a faint border, go undetected.
                  allowedMismatchedPixelRatio: 0.001,
                },
                // Committed references cannot share the ignored `__screenshots__` directory with failure
                // screenshots. The `<name>-<browser>-<platform>` suffix keeps one reference per platform.
                resolveScreenshotPath: ({ arg, browserName, ext, platform, root, testFileDirectory, testFileName }) =>
                  join(root, testFileDirectory, '__visual-baselines__', testFileName, `${arg}-${browserName}-${platform}${ext}`),
              },
            },
          },
        },
      },
    ],
  },
}))
