import Info from 'unplugin-info/vite'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

export default withCpuSlots(defineConfig({
  // Stage UI stores reach build metadata through `~build/*` virtual modules.
  plugins: [Info()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
}))
