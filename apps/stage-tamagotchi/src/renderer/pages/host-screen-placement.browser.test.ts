import type { HostId } from '@proj-airi/stage-shared/host-capabilities'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia } from 'pinia'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import MainPage from './index.vue'
import StagePage from './stage.vue'

import { electronStageGetState } from '../../shared/eventa'

const display = { id: 7, bounds: { x: 0, y: 0, width: 1600, height: 1000 } }
const windowBounds = { x: 200, y: 300, width: 400, height: 500 }

// Keep the pages and capability store real; isolate IPC, unrelated producers and rendering.
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronAllDisplays: () => ref([display]),
  useElectronWindowBounds: () => ({ x: ref(200), y: ref(300), width: ref(400), height: ref(500) }),
  useElectronRelativeMouse: () => ({ x: ref(20), y: ref(30), available: ref(true) }),
  useElectronMouseInElement: () => ({ isOutside: ref(true) }),
  useElectronMouseInWindow: () => ({ isOutside: ref(false) }),
  useElectronMouseAroundWindowBorder: () => ({ isNearAnyBorder: ref(false) }),
  useElectronEventaContext: () => ref({ on: () => () => {} }),
  useElectronEventaInvoke: (event: unknown) => async () => event === electronStageGetState
    ? {
        displays: [{ id: 'home', workArea: { x: 0, y: 0, width: 1600, height: 1000 } }],
        homeDisplayId: 'home',
        homes: { home: { xDip: 400 } },
      }
    : { visible: false, bounds: null },
}))
vi.mock('@proj-airi/stage-ui/components/scenes', () => ({
  WidgetStage: defineComponent({
    props: ['screenPlacement'],
    setup(props, { expose }) {
      expose({ canvasElement: () => undefined })
      return () => h('output', { 'data-testid': 'stage-placement' }, JSON.stringify(props.screenPlacement) ?? 'undefined')
    },
  }),
}))
vi.mock('@proj-airi/stage-ui/components', () => ({ HearingStatus: () => null, HoloCoupon: () => null }))
vi.mock('@proj-airi/stage-ui/composables/canvas-alpha', () => ({
  useCanvasPixelIsTransparentAtPoint: () => ref(false),
  CanvasRegionAlphaReader: class {},
  isCanvasRegionTransparent: () => false,
}))
vi.mock('@proj-airi/stage-ui-three/composables/hit-test', () => ({
  useThreeSceneIsTransparentAtPoint: () => ref(false),
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
vi.mock('../composables/model-settings-runtime-owner', () => ({ useModelSettingsRuntimeOwner: () => {} }))
vi.mock('../components/stage-islands/controls-island/controls-island-root.vue', () => ({ default: () => null }))
vi.mock('../components/stage-islands/controls-island/index.vue', () => ({ default: () => null }))
vi.mock('../components/stage-islands/resource-status-island/index.vue', () => ({ default: () => null }))

describe.each([['classic', MainPage], ['desktop', StagePage]] as const)('%s screen placement', (_name, component) => {
  it.each<HostId>(['windows', 'macos', 'linux-x11', 'linux-xwayland'])('preserves live-origin bounds on %s', async (host) => {
    const pinia = createPinia()
    useHostCapabilitiesStore(pinia).set(capabilitiesForHost(host))
    const view = await render(component, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en' })] } })
    onTestFinished(() => view.unmount())

    await expect.element(view.getByTestId('stage-placement')).toHaveTextContent(JSON.stringify({
      displays: [display.bounds],
      windowBounds,
    }))
  })

  it('withholds placement from Stage when the window origin is unavailable', async () => {
    const pinia = createPinia()
    useHostCapabilitiesStore(pinia).set(capabilitiesForHost('linux-wayland'))
    const view = await render(component, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en' })] } })
    onTestFinished(() => view.unmount())

    await expect.element(view.getByTestId('stage-placement')).toHaveTextContent('undefined')
  })
})
