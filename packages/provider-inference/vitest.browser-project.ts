import type { TestProjectInlineConfiguration } from 'vitest/config'

import { playwright } from '@vitest/browser-playwright'

export const providerInferenceBrowserProject: TestProjectInlineConfiguration = {
  root: import.meta.dirname,
  test: {
    name: 'browser',
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
}
