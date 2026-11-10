import type { TestProjectInlineConfiguration } from 'vitest/config'

import { join } from 'node:path'

import { playwright } from '@vitest/browser-playwright'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { createStageUiProject } from './vitest.shared-project.ts'

// Match the Playwright page to Vitest's iframe viewport for unscaled screenshots.
const testViewport = { width: 414, height: 896 }
const shared = createStageUiProject()

export const stageUiBrowserProject: TestProjectInlineConfiguration = {
  ...shared,
  test: {
    ...shared.test,
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
}
