import { vi } from 'vitest'

// Main-process tests run in Node, which does not provide Electron's process APIs.
// Keep the real host platform; tests of version-dependent capabilities override this fixture.
vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:process')>()
  return {
    ...actual,
    default: {
      ...actual,
      getSystemVersion: () => '14.2.0',
    },
  }
})
