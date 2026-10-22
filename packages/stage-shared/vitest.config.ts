import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

import { domStorageExecArgv } from '../../vitest.dom-storage'

export default withCpuSlots(defineConfig({
  test: {
    execArgv: domStorageExecArgv,
    include: ['src/**/*.test.ts'],
  },
}))
