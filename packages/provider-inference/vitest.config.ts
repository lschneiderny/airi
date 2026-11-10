import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

import { providerInferenceBrowserProject } from './vitest.browser-project'
import { providerInferenceNodeProject } from './vitest.node-project'

export default withCpuSlots(defineConfig({
  root: import.meta.dirname,
  test: { projects: [providerInferenceNodeProject, providerInferenceBrowserProject] },
}))
