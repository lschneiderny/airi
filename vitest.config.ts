import { defineConfig } from 'vitest/config'

// Every workspace package runs its own tests through its `test:run` script. This config holds only the tests that
// belong to no package.
export default defineConfig({
  test: {
    projects: [
      // Root developer tools (`pnpm verify`, `pnpm wt`, `pnpm dev:top`).
      {
        test: {
          name: 'dev-tools',
          include: ['scripts/dev-tools/**/*.test.ts'],
          setupFiles: ['scripts/dev-tools/vitest-isolate-host-session.ts'],
        },
      },
      // Root development scripts, such as the `pnpm dev:*` launcher.
      {
        test: {
          name: 'root-scripts',
          include: ['scripts/**/*.test.mjs'],
        },
      },
    ],
  },
})
