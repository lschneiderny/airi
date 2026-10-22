import Vue from '@vitejs/plugin-vue'
import Unocss from 'unocss/vite'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

export default withCpuSlots(defineConfig({
  root: import.meta.dirname,
  plugins: [
    Vue(),
    Unocss(),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
}))
