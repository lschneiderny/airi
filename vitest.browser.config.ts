import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

import { stageTamagotchiBrowserProject } from './apps/stage-tamagotchi/vitest.browser-project'
import { stageWebBrowserProject } from './apps/stage-web/vitest.browser-project'
import { audioBrowserProject } from './packages/audio/vitest.browser-project'
import { modelDriverLipsyncBrowserProject } from './packages/model-driver-lipsync/vitest.browser-project'
import { providerInferenceBrowserProject } from './packages/provider-inference/vitest.browser-project'
import { stagePagesBrowserProject } from './packages/stage-pages/vitest.browser-project'
import { stageUiLive2dBrowserProject } from './packages/stage-ui-live2d/vitest.browser-project'
import { stageUiMmdBrowserProject } from './packages/stage-ui-mmd/vitest.browser-project'
import { stageUiThreeBrowserProject } from './packages/stage-ui-three/vitest.browser-project'
import { stageUiBrowserProject } from './packages/stage-ui/vitest.browser-project'

export default withCpuSlots(defineConfig({
  test: {
    projects: [
      { project: stageUiLive2dBrowserProject, name: 'stage-ui-live2d:browser' },
      { project: modelDriverLipsyncBrowserProject, name: 'model-driver-lipsync:browser' },
      { project: stageUiThreeBrowserProject, name: 'stage-ui-three:browser' },
      { project: stageUiMmdBrowserProject, name: 'stage-ui-mmd:browser' },
      { project: audioBrowserProject, name: 'audio:browser' },
      { project: stageUiBrowserProject, name: 'stage-ui:browser' },
      { project: stageTamagotchiBrowserProject, name: 'stage-tamagotchi:browser' },
      { project: providerInferenceBrowserProject, name: 'provider-inference:browser' },
      { project: stagePagesBrowserProject, name: 'stage-pages:browser' },
      { project: stageWebBrowserProject, name: 'stage-web:browser' },
    ].map(({ project, name }) => ({ ...project, test: { ...project.test, name } })),
  },
}))
