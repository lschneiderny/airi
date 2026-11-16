import { join } from 'node:path'

import fakemic, { electron } from '@proj-airi/vitest-plugin-fakemic'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

export default withCpuSlots(defineConfig({
  test: {
    projects: [
      fakemic({
        name: 'audio-electron',
        include: ['cases/**/*.audio.test.ts', 'cases/**/*.audio.electron.test.ts'],
        runtime: electron({
          name: 'electron',
          prepare: new URL('./src/runtimes/prepare-electron.ts', import.meta.url).href,
          entry: join(import.meta.dirname, '../../apps/stage-tamagotchi/out/main/index.js'),
          args: ['--no-sandbox'],
          cwd: join(import.meta.dirname, '../..'),
          temporaryUserData: {
            env: 'APP_USER_DATA_PATH',
            prefix: 'airi-testing-audio-',
          },
        }),
      }),
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
}))
