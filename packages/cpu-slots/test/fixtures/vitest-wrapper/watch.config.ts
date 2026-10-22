import { defineConfig } from 'vitest/config'

import { withCpuSlots } from '../../../src/vitest'

export default withCpuSlots(defineConfig({
  test: { name: 'watch', watch: true, include: ['probe.fixture.ts'] },
}))
