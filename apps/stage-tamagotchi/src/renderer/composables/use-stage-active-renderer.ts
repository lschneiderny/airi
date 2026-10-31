import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'

import { electronStageSetActiveRenderer } from '../../shared/eventa'

/**
 * Records the stage model's renderer in the stage config, so the next launch only builds the desktop stage for an MMD
 * model. Both the classic page and the desktop stage page call it, so classic mode records `'mmd'` before a relaunch.
 */
export function useStageActiveRenderer(): void {
  const { stageModelRenderer } = storeToRefs(useSettings())
  const setActiveRenderer = useElectronEventaInvoke(electronStageSetActiveRenderer)

  watch(() => stageModelRenderer.value === 'mmd' ? 'mmd' : 'other', (renderer) => {
    setActiveRenderer(renderer)
      .catch(error => console.warn('[Stage] Failed to record the active renderer:', errorMessageFrom(error)))
  }, { immediate: true })
}
