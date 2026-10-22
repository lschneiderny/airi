import { defineConfig } from 'vitest/config'

import { withCpuSlots } from '../../../src/vitest'

export default withCpuSlots(defineConfig({
  test: { name: 'project', include: ['probe.fixture.ts'] },
}))
