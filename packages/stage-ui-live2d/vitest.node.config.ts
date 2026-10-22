import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineProject } from 'vitest/config'

export default withCpuSlots(defineProject({
  root: import.meta.dirname,
  test: {
    name: 'stage-ui-live2d:node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.browser.test.ts', '**/node_modules/**', '**/.git/**'],
  },
}))
