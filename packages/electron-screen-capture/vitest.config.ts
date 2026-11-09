import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'electron-screen-capture',
    include: ['src/**/*.test.ts'],
  },
})
