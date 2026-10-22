import Info from 'unplugin-info/vite'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

import { domStorageExecArgv } from '../../vitest.dom-storage'

export default withCpuSlots(defineConfig({
  // Stage UI stores reach build metadata through `~build/*` virtual modules.
  plugins: [Info()],
  test: {
    environment: 'jsdom',
    execArgv: domStorageExecArgv,
    include: ['src/**/*.test.ts'],
  },
}))
