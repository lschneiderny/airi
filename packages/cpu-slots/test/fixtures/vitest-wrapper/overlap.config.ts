import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

export default withCpuSlots(defineConfig({
  test: { name: 'overlap', include: ['overlap-*.fixture.ts'] },
}))
