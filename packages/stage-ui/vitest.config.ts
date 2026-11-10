import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

import { stageUiBrowserProject } from './vitest.browser-project'
import { stageUiNodeProject } from './vitest.node-project'

export default withCpuSlots(defineConfig({
  root: import.meta.dirname,
  test: { projects: [stageUiNodeProject, stageUiBrowserProject] },
}))
