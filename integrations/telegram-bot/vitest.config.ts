import { cwd } from 'node:process'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(async ({ mode }) => {
  console.info('mode', mode)

  return withCpuSlots({
    test: {
      // mode defines what ".env.{mode}" file to choose if exists
      env: loadEnv(mode, cwd(), ''),
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: ['**/*.{spec,test}.ts'],
            exclude: ['**/*.browser.{spec,test}.ts', '**/node_modules/**'],
          },
        },
      ],
    },
  })()
})
