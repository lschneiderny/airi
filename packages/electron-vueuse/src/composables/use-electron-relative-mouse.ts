import type { UseMouseOptions } from '@vueuse/core'

import { computed } from 'vue'

import { startPointerSampleReports } from './pointer-samples'
import { useElectronCursorAvailable, useElectronMouse } from './use-electron-mouse'
import { useElectronWindowBounds } from './use-electron-window-bounds'

export function useElectronRelativeMouse(options?: UseMouseOptions) {
  const mouse = useElectronMouse(options)
  const { x: windowX, y: windowY, available: boundsAvailable } = useElectronWindowBounds()
  const cursorAvailable = useElectronCursorAvailable()
  // Main compares these window-relative samples with the compositor cursor to verify it.
  startPointerSampleReports()

  // Transform screen coordinates to window-relative coordinates
  const x = computed(() => mouse.x.value - windowX.value)
  const y = computed(() => mouse.y.value - windowY.value)

  return {
    ...mouse,
    available: computed(() => cursorAvailable.value && boundsAvailable.value),
    x,
    y,
  }
}
