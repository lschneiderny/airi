import type { MaybeRefOrGetter } from 'vue'

import { electron } from '@proj-airi/electron-eventa'
import { beforeEach, vi } from 'vitest'
import { computed, defineComponent, h, onMounted, ref, shallowRef, toValue } from 'vue'

import MainPageComponent from './index.vue'
import StagePageComponent from './stage.vue'

import { electronStageGetState } from '../../shared/eventa'

export const MainPage = MainPageComponent
export const StagePage = StagePageComponent
export const display = { id: 7, bounds: { x: 0, y: 0, width: 1600, height: 1000 } }
export const windowBounds = { x: 200, y: 300, width: 400, height: 500 }
export const boundsX = ref(windowBounds.x)
export const boundsY = ref(windowBounds.y)
export const boundsWidth = ref(windowBounds.width)
export const boundsHeight = ref(windowBounds.height)
export const boundsAvailable = ref(true)
export const cursorAvailable = ref(true)
export const outsideWindow = ref(false)
export const setIgnoreMouseEvents = vi.fn()
export const stageFrame = shallowRef<(args: { timestamp: number, delta: number }) => void>()
export const mountedStage = ref(false)
export const stageCanvas = document.createElement('canvas')
export const samplerReads: Array<{ renderer: 'canvas' | 'three', x: number, y: number }> = []

beforeEach(() => {
  mountedStage.value = false
  samplerReads.length = 0
  boundsAvailable.value = true
  boundsX.value = windowBounds.x
  boundsY.value = windowBounds.y
  boundsWidth.value = windowBounds.width
  boundsHeight.value = windowBounds.height
})

vi.mock('@vueuse/core', async importOriginal => ({
  ...await importOriginal<typeof import('@vueuse/core')>(),
  useRafFn: (callback: typeof stageFrame.value) => {
    stageFrame.value = callback
    return { pause: () => {}, resume: () => {}, isActive: ref(true) }
  },
}))

// Keep pages and Pinia real; isolate IPC, unrelated producers and the renderer boundary.
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronAllDisplays: () => ref([display]),
  useElectronWindowBounds: () => ({ x: boundsX, y: boundsY, width: boundsWidth, height: boundsHeight, available: boundsAvailable }),
  useElectronRelativeMouse: () => ({ x: ref(20), y: ref(30), available: computed(() => cursorAvailable.value && boundsAvailable.value) }),
  useElectronMouseInElement: () => ({ isOutside: ref(true) }),
  useElectronMouseInWindow: () => ({ isOutside: outsideWindow }),
  useElectronMouseAroundWindowBorder: () => ({ isNearAnyBorder: ref(false) }),
  useElectronEventaContext: () => ref({ on: () => () => {} }),
  useElectronEventaInvoke: (event: unknown) => event === electron.window.setIgnoreMouseEvents
    ? setIgnoreMouseEvents
    : async () => event === electronStageGetState
      ? {
          displays: [{ id: 'home', workArea: { x: 0, y: 0, width: 1600, height: 1000 } }],
          homeDisplayId: 'home',
          stageDisplayId: 'home',
          homes: { home: { xDip: 400 } },
        }
      : { visible: false, bounds: null },
}))
vi.mock('@proj-airi/stage-ui/components/scenes', () => ({
  WidgetStage: defineComponent({
    props: ['screenPlacement', 'cursorPosition', 'state'],
    emits: ['update:state'],
    setup(props, { expose, emit }) {
      expose({ canvasElement: () => mountedStage.value ? stageCanvas : undefined })
      onMounted(() => {
        if (mountedStage.value)
          emit('update:state', 'mounted')
      })
      return () => h('div', [
        h('output', { 'data-testid': 'stage-placement' }, JSON.stringify(props.screenPlacement) ?? 'undefined'),
        h('output', { 'data-testid': 'stage-cursor' }, JSON.stringify(props.cursorPosition) ?? 'undefined'),
      ])
    },
  }),
}))
vi.mock('@proj-airi/stage-ui/components', () => ({ HearingStatus: () => null, HoloCoupon: () => null }))
vi.mock('@proj-airi/stage-ui/composables/canvas-alpha', () => ({
  useCanvasPixelIsTransparentAtPoint: (_canvas: unknown, x: MaybeRefOrGetter<number>, y: MaybeRefOrGetter<number>) => computed(() => {
    samplerReads.push({ renderer: 'canvas', x: toValue(x), y: toValue(y) })
    return false
  }),
  CanvasRegionAlphaReader: class {},
  isCanvasRegionTransparent: () => false,
}))
vi.mock('@proj-airi/stage-ui-three/composables/hit-test', () => ({
  useThreeSceneIsTransparentAtPoint: (_scene: unknown, x: MaybeRefOrGetter<number>, y: MaybeRefOrGetter<number>) => computed(() => {
    samplerReads.push({ renderer: 'three', x: toValue(x), y: toValue(y) })
    return false
  }),
}))
vi.mock('@proj-airi/stage-ui-three/stores/model-store', async () => {
  const { defineStore } = await import('pinia')
  return { useModelStore: defineStore('placement-model', () => ({ sceneMutationLocked: ref(false), scenePhase: ref('mounted') })) }
})
vi.mock('@proj-airi/stage-ui-live2d/stores/expression-store', () => ({
  useExpressionStore: () => ({ modelId: null, settingsSnapshot: null }),
}))
vi.mock('@proj-airi/stage-ui-mmd/stores', async () => {
  const { defineStore } = await import('pinia')
  return {
    useMMD: defineStore('placement-mmd', () => ({ stageCharacterHeight: ref(500) })),
    useMMDExpressionStore: () => ({ modelId: null, settingsSnapshot: null }),
    useMMDMotionDiagnostics: () => ({ snapshot: { stageModel: null }, reportReadback: () => {} }),
  }
})
vi.mock('@proj-airi/stage-ui/stores/voice', () => ({
  useVoiceStore: () => ({ connectTools: () => () => {}, drafts: [] }),
}))
vi.mock('@proj-airi/stage-ui/stores/onboarding', () => ({ useOnboardingStore: () => ({ needsOnboarding: false }) }))
vi.mock('@proj-airi/stage-ui/composables/voice-input-mode', () => ({ useVoiceListening: () => {} }))
vi.mock('@proj-airi/stage-ui/features/situation/settings', () => ({
  useSituationSettings: () => ({ document: { shareForegroundWindow: false } }),
}))
vi.mock('../stores/desktop-activity', () => ({ useDesktopActivityProducerStore: () => ({ start: () => {}, stop: () => {} }) }))
vi.mock('../stores/foreground-window', () => ({ useForegroundWindowProducerStore: () => ({ start: () => {}, stop: () => {} }) }))
vi.mock('../stores/stage-window-lifecycle', async () => {
  const { defineStore } = await import('pinia')
  return { useStageWindowLifecycleStore: defineStore('placement-lifecycle', () => ({ stagePaused: ref(false) })) }
})
vi.mock('../stores/tools', () => ({ useToolSelectionStore: () => ({ requestTools: [] }) }))
vi.mock('../composables/use-stage-active-renderer', () => ({ useStageActiveRenderer: () => {} }))
vi.mock('../composables/use-stage-placement-publisher', () => ({ useStagePlacementPublisher: () => {} }))
vi.mock('../composables/use-screen-ambient-light', () => ({ useScreenAmbientLight: () => {} }))
vi.mock('../composables/use-push-to-talk-shortcut', () => ({ usePushToTalkShortcut: () => {} }))
vi.mock('../composables/use-presence-notice', () => ({ usePresenceNotice: () => {} }))
vi.mock('../composables/model-settings-runtime-owner', () => ({ useModelSettingsRuntimeOwner: () => {} }))
vi.mock('../components/stage-islands/controls-island/controls-island-root.vue', () => ({
  default: defineComponent({ props: ['frozen'], setup: (_, { slots }) => () => slots.default?.() }),
}))
vi.mock('../components/stage-islands/controls-island/index.vue', () => ({
  default: defineComponent({
    props: ['cursorAway'],
    setup: props => () => h('output', { 'data-testid': 'cursor-away' }, String(props.cursorAway)),
  }),
}))
vi.mock('../components/stage-islands/resource-status-island/index.vue', () => ({ default: () => null }))
