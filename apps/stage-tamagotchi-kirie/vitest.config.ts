import vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { DownloadLive2DSDK } from '@proj-airi/unplugin-live2d-sdk'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default withCpuSlots(defineConfig({
  root: import.meta.dirname,
  plugins: [
    Info(),
    vue(),
  ],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'jsdom',
          include: [
            'src-web/src/renderer/host-context/**/*.test.ts',
            'src-web/src/renderer/window-context.test.ts',
          ],
          exclude: ['src-web/src/renderer/host-context/**/*.browser.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [
          DownloadLive2DSDK(),
        ],
        test: {
          name: 'browser',
          include: [
            'src-web/src/renderer/host-context/**/*.browser.test.ts',
            'src-web/src/renderer/composables/model-settings-runtime.browser.test.ts',
          ],
          setupFiles: ['../stage-tamagotchi/src/test/setup-live2d.browser.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [
              { browser: 'chromium' },
            ],
          },
        },
      },
    ],
  },
}))
