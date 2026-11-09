import Vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { domStorageExecArgv } from '../../vitest.dom-storage.ts'

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
