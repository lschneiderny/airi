import { defineConfig } from 'vitest/config'

import { withCpuSlots } from '../../../src/vitest'

export default withCpuSlots(defineConfig({
  test: { name: 'root', include: [], projects: ['./vitest.bundled-project.config.ts'] },
}))
