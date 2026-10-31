import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

import { providerInferenceProjects } from './packages/provider-inference/vitest.config'

export default withCpuSlots(defineConfig({
  test: {
    projects: [
      'server/apps/auth',
      'server/apps/api',
      'apps/ui-server-auth',
      'apps/stage-tamagotchi/vitest.node.config.ts',
      'packages/cap-vite',
      'packages/ccc',
      'packages/core-agent',
      'packages/cpu-slots',
      'packages/electron-vueuse',
      'packages/i18n',
      'packages/pipelines-audio',
      'packages/input-gamepad',
      'packages/input-gamepad-vueuse',
      'packages/input-playstation-dualsense-5',
      'packages/model-driver-lipsync/vitest.node.config.ts',
      'packages/better-ws',
      'packages/model-driver-magic-live2d',
      'packages/motion-driver-magic',
      'packages/motion-driver-humanoid',
      'packages/motion-driver-natural',
      'packages/plugin-protocol',
      'packages/stage-layouts',
      'packages/stage-ui-tachie',
      'integrations/minecraft',
      'services/computer-use-mcp',
      'apps/stage-tamagotchi-kirie/vitest.node.config.ts',
      'packages/plugin-sdk',
      'packages/plugin-sdk-tamagotchi',
      ...providerInferenceProjects.map(project => ({ ...project, root: 'packages/provider-inference' })),
      'packages/qa-tools/vitest.node.config.ts',
      'packages/scenarios-stage-tamagotchi-browser',
      'packages/scenarios-stage-tamagotchi-electron',
      'packages/server-runtime',
      'packages/server-sdk',
      'packages/stage-shared',
      'packages/stage-ui-live2d/vitest.node.config.ts',
      'packages/stage-ui-three/vitest.node.config.ts',
      'packages/vitest-plugin-fakemic',
      'packages/vite-plugin-sherpaw',
      // Root developer tools (`pnpm verify`, `pnpm wt`, `pnpm dev:top`). They belong to no package.
      {
        test: {
          name: 'dev-tools',
          include: ['scripts/dev-tools/**/*.test.ts'],
        },
      },
      // The browser extension's background logic. The extension builds with WXT and has no test config of its own.
      {
        test: {
          name: 'web-extension',
          include: ['plugins/airi-plugin-web-extension/src/**/*.test.ts'],
        },
      },
      // Repository scripts under .github. They belong to no package.
      {
        test: {
          name: 'github-scripts',
          include: ['.github/scripts/**/*.test.ts'],
        },
      },
      // Node projects of packages whose own config also holds browser projects. Their browser projects run through
      // `pnpm test:run`'s package scripts. These packages declare no node-only config, so the projects are inline.
      {
        test: {
          name: 'audio:node',
          include: ['packages/audio/src/**/*.test.ts'],
          exclude: ['packages/audio/src/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'stage-ui-mmd:node',
          include: ['packages/stage-ui-mmd/src/**/*.test.ts'],
          exclude: ['packages/stage-ui-mmd/src/**/*.browser.test.ts'],
        },
      },
      // The audio test fixtures. Its fakemic projects need built apps and a microphone runtime, so only the unit project runs here.
      {
        test: {
          name: 'testing-audio:unit',
          include: ['packages/testing-audio/src/**/*.test.ts'],
        },
      },
      // Packages without a Vitest config of their own.
      {
        test: {
          name: 'telegram-bot',
          include: ['integrations/telegram-bot/**/*.test.ts'],
          exclude: ['**/node_modules/**'],
        },
      },
      {
        test: {
          name: 'twitter-services',
          include: ['integrations/twitter-services/src/**/*.test.ts'],
        },
      },
      // Root development scripts, such as the `pnpm dev:*` launcher. They belong to no package.
      {
        test: {
          name: 'root-scripts',
          include: ['scripts/**/*.test.mjs'],
        },
      },
    ],
  },
}))
