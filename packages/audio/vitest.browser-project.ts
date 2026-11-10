import type { TestProjectInlineConfiguration } from 'vitest/config'

import { playwright } from '@vitest/browser-playwright'

export const audioBrowserProject: TestProjectInlineConfiguration = {
  root: import.meta.dirname,
  test: {
    name: 'browser',
    include: ['src/**/*.browser.test.ts'],
    browser: { enabled: true, headless: true, provider: playwright({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } }), instances: [{ browser: 'chromium' }] },
  },
}
