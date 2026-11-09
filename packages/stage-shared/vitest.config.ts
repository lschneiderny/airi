import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { domStorageExecArgv } from '../../vitest.dom-storage.ts'

export default withCpuSlots(defineConfig({
  test: {
    execArgv: domStorageExecArgv,
    include: ['src/**/*.test.ts'],
  },
}))
