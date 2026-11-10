import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { audioBrowserProject } from './vitest.browser-project.ts'

export default withCpuSlots(defineConfig({
  // `pnpm test:run` runs this config from the repo root, where the relative `src/**` includes match nothing.
  root: import.meta.dirname,
  test: {
    projects: [
      { test: { name: 'node', include: ['src/**/*.test.ts'], exclude: ['src/**/*.browser.test.ts'] } },
      audioBrowserProject,
    ],
  },
}))
