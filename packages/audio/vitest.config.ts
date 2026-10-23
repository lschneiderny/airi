import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default withCpuSlots(defineConfig({
  // `pnpm test:run` runs this config from the repo root, where the relative `src/**` includes match nothing.
  root: import.meta.dirname,
  test: {
    projects: [
      { test: { name: 'node', include: ['src/**/*.test.ts'], exclude: ['src/**/*.browser.test.ts'] } },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          browser: { enabled: true, headless: true, provider: playwright({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } }), instances: [{ browser: 'chromium' }] },
        },
      },
    ],
  },
}))
