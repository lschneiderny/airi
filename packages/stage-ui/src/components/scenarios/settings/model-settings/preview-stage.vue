<script setup lang="ts">
import type { ItemExpressionDocument } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DContext } from '@proj-airi/stage-ui-live2d'
import type { Live2DItemEditor } from '@proj-airi/stage-ui-live2d/composables/live2d/items/editor'

import type { ModelSettingsRuntimeSnapshot } from './runtime'

import { Live2DScene, useSettingsLive2d } from '@proj-airi/stage-ui-live2d'
import { SpineScene } from '@proj-airi/stage-ui-spine'
import { TachieScene } from '@proj-airi/stage-ui-tachie'
import { useModelStore } from '@proj-airi/stage-ui-three/stores/model-store'
import { useMouse } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, defineAsyncComponent, ref, watch } from 'vue'

import { useLive2DStageItems } from '../../../../composables/use-live2d-stage-items'
import { useLive2DStageMotionMagic } from '../../../../features/motions/live2d/use-live2d-stage-motion-magic'
import { useSharedLive2DExpressionPreview } from '../../../../stores/live2d'
import { useAiriCardStore } from '../../../../stores/modules/airi-card'
import { useSettings } from '../../../../stores/settings'
import {
  createEmptyModelSettingsRuntimeSnapshot,
  resolveComponentStateToRuntimePhase,
} from './runtime'

const props = defineProps<{
  live2dSceneClass?: string | string[]
  live2dContext: Live2DContext
  vrmSceneClass?: string | string[]
  spineSceneClass?: string | string[]
  tachieSceneClass?: string | string[]
  mmdSceneClass?: string | string[]
  /**
   * The stage items to draw on the Live2D model, in place of this window's own expression store: a window without the
   * stage runtime (the settings preview, the fullscreen window) passes the stage's shown items from the runtime snapshot.
   * The host keeps them within the shown caps.
   */
  live2dItems?: readonly ItemExpressionDocument[]
}>()

const emit = defineEmits<{
  (e: 'runtimeSnapshotChanged', value: ModelSettingsRuntimeSnapshot): void
}>()

// Loaded only when the selected model needs them, like the main stage.
const MMDScene = defineAsyncComponent(() => import('@proj-airi/stage-ui-mmd/components/scenes/MMD.vue'))
const ThreeScene = defineAsyncComponent(() => import('@proj-airi/stage-ui-three/components/ThreeScene.vue'))

const settingsStore = useSettings()
const modelStore = useModelStore()
const { activeCardId, selectedAvatarModelId } = storeToRefs(useAiriCardStore())
useSharedLive2DExpressionPreview(props.live2dContext, activeCardId, selectedAvatarModelId)
const live2dSceneRef = ref<{ canvasElement: () => HTMLCanvasElement | undefined, itemEditor: () => Live2DItemEditor | undefined }>()
const vrmSceneRef = ref<{ canvasElement: () => HTMLCanvasElement | undefined }>()
const spineSceneRef = ref<{ canvasElement: () => HTMLCanvasElement | undefined }>()
const tachieSceneRef = ref<{ canvasElement: () => HTMLCanvasElement | undefined }>()
const mmdSceneRef = ref<{ canvasElement: () => HTMLCanvasElement | undefined }>()
const live2dComponentState = ref<'pending' | 'loading' | 'mounted'>('pending')
const spineComponentState = ref<'pending' | 'loading' | 'mounted'>('pending')
const tachieComponentState = ref<'pending' | 'loading' | 'mounted'>('pending')
const mmdComponentState = ref<'pending' | 'loading' | 'mounted'>('pending')
const vrmPreviewStageInstanceId = `model-settings-preview-stage:${Math.random().toString(36).slice(2, 10)}`

const {
  stageModelSelected,
  stageModelSelectedUrl,
  stageModelRenderer,
  themeColorsHue,
  themeColorsHueDynamic,

} = storeToRefs(settingsStore)
const {
  spinePremultipliedAlpha,
  spineDefaultMixDuration,
  spineIdleAnimationEnabled,
  spineMaxFps,
  spineRenderScale,
} = storeToRefs(settingsStore)
const { sceneMutationLocked, scenePhase } = storeToRefs(modelStore)
const { live2dMotionDriver } = storeToRefs(useSettingsLive2d())

// The web settings route unmounts the main stage, so the preview runs its own driver.
useLive2DStageMotionMagic({
  active: () => stageModelRenderer.value === 'live2d' && live2dMotionDriver.value === 'magic',
})

// Without `live2dItems` the preview draws the items its window's expression store shows, from the same stored documents.
const { items: live2dItems, reportStates: reportLive2DItemStates } = useLive2DStageItems({
  active: () => stageModelRenderer.value === 'live2d',
  documents: () => props.live2dItems,
})

const live2dSceneClassList = computed(() => normalizeClassList(props.live2dSceneClass))
const vrmSceneClassList = computed(() => normalizeClassList(props.vrmSceneClass))
const spineSceneClassList = computed(() => normalizeClassList(props.spineSceneClass))
const tachieSceneClassList = computed(() => normalizeClassList(props.tachieSceneClass))
const mmdSceneClassList = computed(() => normalizeClassList(props.mmdSceneClass))

function normalizeClassList(value?: string | string[]) {
  if (!value)
    return []

  return typeof value === 'string' ? [value] : value
}

function captureCanvasFrame(canvas?: HTMLCanvasElement) {
  return new Promise<Blob | undefined>((resolve) => {
    if (!canvas)
      return resolve(undefined)

    canvas.toBlob(blob => resolve(blob ?? undefined))
  })
}

async function capturePreviewFrame() {
  if (stageModelRenderer.value === 'live2d')
    return captureCanvasFrame(live2dSceneRef.value?.canvasElement())

  if (stageModelRenderer.value === 'vrm')
    return captureCanvasFrame(vrmSceneRef.value?.canvasElement())

  if (stageModelRenderer.value === 'spine')
    return captureCanvasFrame(spineSceneRef.value?.canvasElement())

  if (stageModelRenderer.value === 'tachie')
    return captureCanvasFrame(tachieSceneRef.value?.canvasElement())

  if (stageModelRenderer.value === 'mmd')
    return captureCanvasFrame(mmdSceneRef.value?.canvasElement())

  return undefined
}

const runtimeSnapshot = computed<ModelSettingsRuntimeSnapshot>(() => {
  const hasModel = !!stageModelSelectedUrl.value

  if (stageModelRenderer.value === 'live2d') {
    const phase = resolveComponentStateToRuntimePhase(live2dComponentState.value, { hasModel })

    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId: vrmPreviewStageInstanceId,
      renderer: 'live2d',
      phase,
      controlsLocked: hasModel ? phase !== 'mounted' : false,
      previewAvailable: hasModel,
      canCapturePreview: !!live2dSceneRef.value?.canvasElement(),
      updatedAt: Date.now(),
    })
  }

  if (stageModelRenderer.value === 'vrm') {
    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId: vrmPreviewStageInstanceId,
      renderer: 'vrm',
      phase: hasModel ? scenePhase.value : 'no-model',
      controlsLocked: hasModel ? sceneMutationLocked.value : false,
      previewAvailable: hasModel,
      canCapturePreview: !!vrmSceneRef.value?.canvasElement(),
      updatedAt: Date.now(),
    })
  }

  if (stageModelRenderer.value === 'spine') {
    const phase = resolveComponentStateToRuntimePhase(spineComponentState.value, { hasModel })

    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId: vrmPreviewStageInstanceId,
      renderer: 'spine',
      phase,
      controlsLocked: hasModel ? phase !== 'mounted' : false,
      previewAvailable: hasModel,
      canCapturePreview: !!spineSceneRef.value?.canvasElement(),
      updatedAt: Date.now(),
    })
  }

  if (stageModelRenderer.value === 'tachie') {
    const phase = resolveComponentStateToRuntimePhase(tachieComponentState.value, { hasModel })

    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId: vrmPreviewStageInstanceId,
      renderer: 'tachie',
      phase,
      controlsLocked: hasModel ? phase !== 'mounted' : false,
      previewAvailable: hasModel,
      canCapturePreview: !!tachieSceneRef.value?.canvasElement(),
      updatedAt: Date.now(),
    })
  }

  if (stageModelRenderer.value === 'mmd') {
    const phase = resolveComponentStateToRuntimePhase(mmdComponentState.value, { hasModel })

    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId: vrmPreviewStageInstanceId,
      renderer: 'mmd',
      phase,
      controlsLocked: hasModel ? phase !== 'mounted' : false,
      previewAvailable: hasModel,
      canCapturePreview: !!mmdSceneRef.value?.canvasElement(),
      updatedAt: Date.now(),
    })
  }

  if (stageModelRenderer.value === 'godot') {
    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId: vrmPreviewStageInstanceId,
      renderer: 'godot',
      phase: hasModel ? 'mounted' : 'no-model',
      controlsLocked: false,
      previewAvailable: false,
      canCapturePreview: false,
      updatedAt: Date.now(),
    })
  }

  return createEmptyModelSettingsRuntimeSnapshot({
    ownerInstanceId: vrmPreviewStageInstanceId,
    updatedAt: Date.now(),
  })
})

watch(runtimeSnapshot, snapshot => emit('runtimeSnapshotChanged', snapshot), { immediate: true })

defineExpose({
  capturePreviewFrame,
  /** The placement editor's view of the Live2D model; `undefined` until the Live2D scene has a model. */
  live2dItemEditor: () => live2dSceneRef.value?.itemEditor(),
})

const { x: mouseX, y: mouseY } = useMouse()
const cursorPosition = computed(() => ({
  x: mouseX.value,
  y: mouseY.value,
}))
</script>

<template>
  <template v-if="stageModelRenderer === 'live2d'">
    <div :class="live2dSceneClassList">
      <Live2DScene
        ref="live2dSceneRef"
        v-model:state="live2dComponentState"
        :context="live2dContext"
        :model-src="stageModelSelectedUrl"
        :model-id="stageModelSelected"
        :cursor-position="cursorPosition"
        :theme-colors-hue="themeColorsHue"
        :theme-colors-hue-dynamic="themeColorsHueDynamic"
        :items="live2dItems"
        @item-states="reportLive2DItemStates"
      />
    </div>
  </template>
  <template v-if="stageModelRenderer === 'vrm'">
    <div :class="vrmSceneClassList">
      <ThreeScene ref="vrmSceneRef" :cursor-position="cursorPosition" :model-id="stageModelSelected" :model-src="stageModelSelectedUrl" />
    </div>
  </template>
  <template v-if="stageModelRenderer === 'spine'">
    <div :class="spineSceneClassList">
      <SpineScene
        ref="spineSceneRef"
        v-model:state="spineComponentState"
        :model-src="stageModelSelectedUrl"
        :model-id="stageModelSelected"
        :premultiplied-alpha="spinePremultipliedAlpha"
        :default-mix-duration="spineDefaultMixDuration"
        :idle-animation-enabled="spineIdleAnimationEnabled"
        :max-fps="spineMaxFps"
        :render-scale="spineRenderScale"
      />
    </div>
  </template>
  <template v-if="stageModelRenderer === 'mmd'">
    <div :class="mmdSceneClassList">
      <MMDScene
        ref="mmdSceneRef"
        v-model:state="mmdComponentState"
        :model-src="stageModelSelectedUrl"
        :model-id="stageModelSelected"
        :cursor-position="cursorPosition"
        :enable-orbit-controls="true"
      />
    </div>
  </template>
  <template v-if="stageModelRenderer === 'tachie'">
    <div :class="tachieSceneClassList">
      <TachieScene
        ref="tachieSceneRef"
        v-model:state="tachieComponentState"
        :model-src="stageModelSelectedUrl"
        :model-id="stageModelSelected"
        :theme-colors-hue="themeColorsHue"
        :theme-colors-hue-dynamic="themeColorsHueDynamic"
      />
    </div>
  </template>
</template>
