import Vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

import { domStorageExecArgv } from '../../vitest.dom-storage'

export default withCpuSlots(defineConfig({
  // Stage UI stores reach build metadata through `~build/*` virtual modules.
  // `vitest related` walks the static import graph, which reaches .vue files from stage-ui and stage-ui-three.
  plugins: [Info(), Vue()],
  test: {
    environment: 'jsdom',
    execArgv: domStorageExecArgv,
    include: ['src/**/*.test.ts'],
  },
}))
