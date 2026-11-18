import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

export default withCpuSlots(defineConfig({
  test: {
    name: '@proj-airi/agents',
    include: ['src/**/*.test.ts'],
  },
}))
