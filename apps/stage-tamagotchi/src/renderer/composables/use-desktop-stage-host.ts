import type { DesktopStageHost } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/desktop-stage'
import type { Ref } from 'vue'

import type { StageHostState } from '../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { desktopStageNeedsRelaunch } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/desktop-stage'
import { computed, onScopeDispose, shallowRef } from 'vue'

import {
  electronStageGetState,
  electronStageRelaunch,
  electronStageSetExperimental,
  electronStageSetFollowMe,
  electronStageSetHomeDisplay,
  electronStageStateChanged,
} from '../../shared/eventa'

export interface DesktopStageSettingsHost {
  host: DesktopStageHost
  /**
   * True while the stage model's renderer is not MMD and the Experimental 3D stage setting is on or the desktop stage
   * runs. The next launch builds the classic window; the page shows `settings.mmd.stage.non-mmd-notice`.
   */
  nonMmdNotice: Readonly<Ref<boolean>>
  /** True while the next launch would build a different host than the running one, so a relaunch is needed. */
  needsRelaunch: Readonly<Ref<boolean>>
}

/**
 * Implements the desktop stage settings port over the stage eventa contracts, for the settings window.
 *
 * Only an MMD model can stand on the desktop stage. The stage pages record the stage model's renderer in the host state
 * (`activeRenderer`, see `useStageActiveRenderer`). While it is not MMD and the setting is on, `nonMmdNotice` is on
 * until an MMD model is selected again.
 */
export function useDesktopStageHost(): DesktopStageSettingsHost {
  const context = useElectronEventaContext()
  const getState = useElectronEventaInvoke(electronStageGetState)
  const setExperimentalInvoke = useElectronEventaInvoke(electronStageSetExperimental)
  const setHomeDisplayInvoke = useElectronEventaInvoke(electronStageSetHomeDisplay)
  const setFollowMeInvoke = useElectronEventaInvoke(electronStageSetFollowMe)
  const relaunchInvoke = useElectronEventaInvoke(electronStageRelaunch)

  const state = shallowRef<StageHostState | null>(null)
  const nonMmdNotice = computed(() => state.value?.activeRenderer === 'other' && (state.value.experimental || state.value.running === 'desktop'))
  const needsRelaunch = computed(() => state.value !== null && desktopStageNeedsRelaunch(state.value))

  onScopeDispose(context.value.on(electronStageStateChanged, (event) => {
    if (event.body)
      state.value = event.body
  }))

  getState()
    .then((next) => { state.value ??= next })
    .catch(error => console.warn('[Stage] Failed to read the stage state:', errorMessageFrom(error)))

  return {
    host: {
      state,
      setExperimental: async (enabled) => {
        state.value = await setExperimentalInvoke(enabled)
      },
      setHomeDisplay: async (displayId) => {
        state.value = await setHomeDisplayInvoke(displayId)
      },
      setFollowMe: async (enabled) => {
        state.value = await setFollowMeInvoke(enabled)
      },
      relaunch: () => relaunchInvoke(),
    },
    nonMmdNotice,
    needsRelaunch,
  }
}
