import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

export default withCpuSlots(defineConfig({
  test: {
    name: '@proj-airi/core-agent',
    include: ['src/**/*.test.ts'],
  },
}))
