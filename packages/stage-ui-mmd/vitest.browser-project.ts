import type { TestProjectInlineConfiguration } from 'vitest/config'

import { playwright } from '@vitest/browser-playwright'

export const stageUiMmdBrowserProject: TestProjectInlineConfiguration = {
  root: import.meta.dirname,
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
}
