import type { DisplayModelSettingsScope } from '@proj-airi/stage-shared/composables'
import type {} from 'pinia-plugin-synced'

import type { DisplayModel } from '../display-models'

import { setActiveDisplayModelForSettings } from '@proj-airi/stage-shared/composables'
import { refManualReset, useEventListener } from '@vueuse/core'
import { defineStore, getActivePinia, storeToRefs } from 'pinia'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { DisplayModelFormat, useDisplayModelsStore } from '../display-models'

export type StageModelRenderer = 'live2d' | 'vrm' | 'spine' | 'tachie' | 'mmd' | 'godot' | 'disabled' | undefined
type BuiltInStageModelRenderer = Exclude<StageModelRenderer, 'godot'>

/** The settings group that each built-in renderer reads. A renderer without settings has no entry. */
const settingsScopeByRenderer: Partial<Record<NonNullable<BuiltInStageModelRenderer>, DisplayModelSettingsScope>> = {
  live2d: 'live2d',
  vrm: 'three',
  mmd: 'mmd',
  spine: 'spine',
  tachie: 'tachie',
}

const useStageModelSelectionStore = defineStore('settings-stage-model-selection', () => {
  // The active Character owns the durable Avatar Model references. This store
  // only replicates the current runtime selection between renderer windows.
  const selected = shallowRef('')

  function resetState() {
    selected.value = ''
  }

  return {
    selected,
    resetState,
  }
}, {
  synced: {
    state: true,
  },
})

export const useSettingsStageModel = defineStore('settings-stage-model', () => {
  const displayModelsStore = useDisplayModelsStore()
  const stageModelSelectionStore = useStageModelSelectionStore()
  const { selected: stageModelSelectedState } = storeToRefs(stageModelSelectionStore)
  let stageModelUpdateSequence = 0
  // The load that runs now. A pick writes the selection, so the selection watcher and the picker
  // both request a load of the same model. The second request waits for the first load.
  let activeStageModelUpdate: { modelId: string, requestId: number, promise: Promise<void> } | undefined
  let legacyModelIdentityResetPromise: Promise<void> | undefined
  // The Three.js store loads after an await. By then another Pinia can be
  // active, or this one can be disposed, so keep the Pinia that owns this store.
  const pinia = getActivePinia()
  let disposed = false
  onScopeDispose(() => {
    disposed = true
    // Cancel a pending update. Its next store action would make this disposed Pinia active again.
    stageModelUpdateSequence++
  })
  const stageModelSelected = computed<string>({
    get: () => stageModelSelectedState.value,
    set: (value) => {
      stageModelSelectedState.value = value
    },
  })
  const stageModelSelectedDisplayModel = refManualReset<DisplayModel | undefined>(undefined)
  const stageModelSelectedUrl = refManualReset<string | undefined>(undefined)
  const stageModelRenderer = refManualReset<StageModelRenderer>(undefined)
  const stageModelBuiltInRenderer = refManualReset<BuiltInStageModelRenderer>(undefined)
  // True when the selected model is not on this device. The Stage then asks the user to select
  // another model.
  const stageModelUnavailable = refManualReset<boolean>(false)

  const stageViewControlsEnabled = refManualReset<boolean>(false)

  function revokeStageModelUrl(url?: string) {
    if (url?.startsWith('blob:'))
      URL.revokeObjectURL(url)
  }

  function replaceStageModelUrl(nextUrl?: string) {
    if (stageModelSelectedUrl.value === nextUrl)
      return

    revokeStageModelUrl(stageModelSelectedUrl.value)
    stageModelSelectedUrl.value = nextUrl
  }

  function resolveBuiltInStageModelRenderer(model?: DisplayModel): BuiltInStageModelRenderer {
    if (!model) {
      return 'disabled'
    }

    switch (model.format) {
      case DisplayModelFormat.Live2dZip:
        return 'live2d'
      case DisplayModelFormat.VRM:
        return 'vrm'
      case DisplayModelFormat.SpineZip:
        return 'spine'
      case DisplayModelFormat.TachieZip:
        return 'tachie'
      case DisplayModelFormat.PMXZip:
      case DisplayModelFormat.PMXDirectory:
      case DisplayModelFormat.PMD:
        return 'mmd'
      default:
        return 'disabled'
    }
  }

  function resetLegacyModelIdentity() {
    if (typeof window === 'undefined')
      return undefined

    // The Three.js store is browser-only. Load it only during browser startup so
    // Node consumers of the shared settings store do not evaluate rendering APIs.
    // Import the store subpath: the package root also loads the VRM scene.
    legacyModelIdentityResetPromise ??= import('@proj-airi/stage-ui-three/stores/model-store').then(({ useModelStore }) => {
      // A disposed Pinia cannot create the Three.js store, and nothing renders it anymore.
      if (disposed)
        return
      useModelStore(pinia).resetLegacyModelIdentity()
    })

    return legacyModelIdentityResetPromise
  }

  function updateStageModel() {
    const selectedModelId = stageModelSelectedState.value
    if (activeStageModelUpdate?.modelId === selectedModelId)
      return activeStageModelUpdate.promise

    const requestId = ++stageModelUpdateSequence
    const promise = loadStageModel(selectedModelId, requestId).finally(() => {
      if (activeStageModelUpdate?.requestId === requestId)
        activeStageModelUpdate = undefined
    })
    activeStageModelUpdate = { modelId: selectedModelId, requestId, promise }
    return promise
  }

  async function loadStageModel(selectedModelId: string, requestId: number) {
    stageModelUnavailable.value = false

    const legacyModelIdentityReset = resetLegacyModelIdentity()
    if (legacyModelIdentityReset) {
      await legacyModelIdentityReset
      if (requestId !== stageModelUpdateSequence)
        return
    }

    if (!selectedModelId) {
      replaceStageModelUrl(undefined)
      stageModelSelectedDisplayModel.value = undefined
      stageModelBuiltInRenderer.value = 'disabled'
      if (stageModelRenderer.value !== 'godot')
        stageModelRenderer.value = 'disabled'
      return
    }

    const model = await displayModelsStore.getDisplayModel(selectedModelId)
    if (requestId !== stageModelUpdateSequence)
      return

    if (!model) {
      replaceStageModelUrl(undefined)
      stageModelSelectedDisplayModel.value = undefined
      stageModelUnavailable.value = true
      stageModelBuiltInRenderer.value = 'disabled'
      if (stageModelRenderer.value !== 'godot')
        stageModelRenderer.value = 'disabled'
      return
    }

    let nextUrl: string
    if (model.type === 'file') {
      nextUrl = URL.createObjectURL(model.file)
      if (requestId !== stageModelUpdateSequence) {
        URL.revokeObjectURL(nextUrl)
        return
      }
    }
    else {
      nextUrl = model.url
    }

    const builtInRenderer = resolveBuiltInStageModelRenderer(model)

    // The renderer reads the settings of this model from its first frame. Select them before
    // the refs publish the model.
    const settingsScope = builtInRenderer ? settingsScopeByRenderer[builtInRenderer] : undefined
    if (settingsScope)
      setActiveDisplayModelForSettings(settingsScope, model.id)

    // Browser startup consumes the one-time legacy reset before these refs publish.
    // Direct ThreeScene routes mount from the refs and cannot start with stale identity state.
    stageModelBuiltInRenderer.value = builtInRenderer
    if (stageModelRenderer.value !== 'godot')
      stageModelRenderer.value = builtInRenderer
    replaceStageModelUrl(nextUrl)
    stageModelSelectedDisplayModel.value = model
  }

  function setStageModelRenderer(renderer: StageModelRenderer) {
    stageModelRenderer.value = renderer
  }

  function restoreBuiltInStageModelRenderer() {
    stageModelRenderer.value = stageModelBuiltInRenderer.value ?? 'disabled'
  }

  async function initializeStageModel() {
    await updateStageModel()
  }

  useEventListener('unload', () => {
    revokeStageModelUrl(stageModelSelectedUrl.value)
  })

  watch(stageModelSelectedState, (_newValue, _oldValue) => {
    void updateStageModel()
  })

  async function resetState() {
    revokeStageModelUrl(stageModelSelectedUrl.value)

    stageModelSelectionStore.resetState()
    stageModelSelectedDisplayModel.reset()
    stageModelSelectedUrl.reset()
    stageModelRenderer.reset()
    stageModelBuiltInRenderer.reset()
    stageModelUnavailable.reset()
    stageViewControlsEnabled.reset()

    await updateStageModel()
  }

  return {
    stageModelRenderer,
    stageModelSelected,
    stageModelSelectedUrl,
    stageModelSelectedDisplayModel,
    stageModelUnavailable,
    stageViewControlsEnabled,

    initializeStageModel,
    restoreBuiltInStageModelRenderer,
    setStageModelRenderer,
    updateStageModel,
    resetState,
  }
})
