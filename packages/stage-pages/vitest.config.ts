import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'

// eslint-disable-next-line no-restricted-syntax -- Vite's native config loader, its planned default, resolves a relative import only with its extension.
import { stagePagesBrowserProject } from './vitest.browser-project.ts'

export default withCpuSlots(stagePagesBrowserProject)
