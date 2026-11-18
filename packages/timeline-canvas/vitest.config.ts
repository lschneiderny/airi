import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

export default withCpuSlots(defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
