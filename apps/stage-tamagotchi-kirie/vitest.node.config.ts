import vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineProject } from 'vitest/config'

export default withCpuSlots(defineProject({
  root: import.meta.dirname,
  plugins: [
    Info(),
    vue(),
  ],
  test: {
    name: 'stage-tamagotchi-kirie:node',
    environment: 'jsdom',
    include: [
      'src-web/src/renderer/host-context/**/*.test.ts',
      'src-web/src/renderer/window-context.test.ts',
    ],
    exclude: ['src-web/src/renderer/host-context/**/*.browser.test.ts'],
  },
}))
