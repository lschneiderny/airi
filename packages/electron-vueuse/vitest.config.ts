import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'electron-vueuse',
    include: ['src/**/*.test.ts'],
  },
})
