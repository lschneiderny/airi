import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

export default withCpuSlots(defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'electron-screen-capture',
    include: ['src/**/*.test.ts'],
  },
}))
