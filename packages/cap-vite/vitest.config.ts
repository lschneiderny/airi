import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

export default withCpuSlots(defineConfig({
  root,
  test: {
    include: ['src/**/*.test.ts'],
  },
}))
