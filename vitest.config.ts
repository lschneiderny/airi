import type { TestProjectInlineConfiguration } from 'vitest/config'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { stageTamagotchiNodeProject } from './apps/stage-tamagotchi/vitest.node-project.ts'
// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { modelDriverLipsyncNodeProject } from './packages/model-driver-lipsync/vitest.node-project.ts'
// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { providerInferenceNodeProject } from './packages/provider-inference/vitest.node-project.ts'
// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { stageUiLive2dNodeProject } from './packages/stage-ui-live2d/vitest.node-project.ts'
// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { stageUiThreeNodeProject } from './packages/stage-ui-three/vitest.node-project.ts'
// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { stageUiNodeProject } from './packages/stage-ui/vitest.node-project.ts'

/** A package's node project under a repository-unique name; inside its package config it is just `node`. */
function named(project: TestProjectInlineConfiguration, name: string): TestProjectInlineConfiguration {
  return { ...project, test: { ...project.test, name } }
}

export default withCpuSlots(defineConfig({
  test: {
    projects: [
      'server/apps/auth',
      'server/apps/api',
      named(stageTamagotchiNodeProject, 'stage-tamagotchi:node'),
      'packages/ccc',
      'packages/core-agent',
      'packages/cpu-slots',
      'packages/electron-screen-capture',
      'packages/electron-vueuse',
      'packages/i18n',
      'packages/pipelines-audio',
      'packages/input-gamepad',
      'packages/input-gamepad-vueuse',
      'packages/input-playstation-dualsense-5',
      named(modelDriverLipsyncNodeProject, 'model-driver-lipsync:node'),
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
      'packages/plugin-sdk',
      'packages/plugin-sdk-tamagotchi',
      providerInferenceNodeProject,
      named(stageUiNodeProject, 'stage-ui:node'),
      'packages/qa-tools/vitest.node.config.ts',
      'packages/scenarios-stage-tamagotchi-browser',
      'packages/scenarios-stage-tamagotchi-electron',
      'packages/server-runtime',
      'packages/server-sdk',
      'packages/stage-shared',
      named(stageUiLive2dNodeProject, 'stage-ui-live2d:node'),
      named(stageUiThreeNodeProject, 'stage-ui-three:node'),
      'packages/vitest-plugin-fakemic',
      'packages/vite-plugin-sherpaw',
      // Root developer tools (`pnpm verify`, `pnpm wt`, `pnpm dev:top`). They belong to no package.
      {
        test: {
          name: 'dev-tools',
          include: ['scripts/dev-tools/**/*.test.ts'],
          setupFiles: ['scripts/dev-tools/vitest-isolate-host-session.ts'],
        },
      },
      // The browser extension's background logic. The extension builds with WXT and has no test config of its own.
      {
        test: {
          name: 'web-extension',
          include: ['plugins/airi-plugin-web-extension/src/**/*.test.ts'],
        },
      },
      // Node projects of packages whose own config also holds browser projects. Their browser projects run in
      // `vitest.browser.config.ts`. These packages declare no node-only config, so the projects are inline.
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
