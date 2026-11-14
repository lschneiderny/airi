import type { getElectronEventaContext } from '@proj-airi/electron-vueuse'

import type { PerfRecordingState } from '../../shared/eventa/perf-recording'
import type { WindowTagSnapshot } from '../libs/perf/window-tags'
import type { PerfStageWindow } from '../window-context'

import { useLogg } from '@guiiai/logg'
import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { useNaturalMotionDiagnostics, useSettingsLive2d } from '@proj-airi/stage-ui-live2d'
import { useMMD, useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useStageSelfStore } from '@proj-airi/stage-ui/stores/self'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { useSpeechOutputControlStore } from '@proj-airi/stage-ui/stores/speech-output-control'
import { useWakeWordDetectionStore } from '@proj-airi/stage-ui/stores/wake-word-detection'
import { getActivePinia } from 'pinia'
import { watch } from 'vue'

import {
  perfRecordingChanged,
  perfRecordingGet,
  perfRecordingPullFrameRing,
  perfRecordingPullRollup,
  perfRecordingRendererReload,
} from '../../shared/eventa/perf-recording'
import { WindowPerfEvents } from '../libs/perf/window-events'
import { resolveWindowTags } from '../libs/perf/window-tags'
import { WindowUsageSampler } from '../libs/perf/window-usage-sampler'
import { useStageThreeRuntimeDiagnosticsStore } from '../stores/stage-three-runtime-diagnostics'
import { useStageWindowLifecycleStore } from '../stores/stage-window-lifecycle'

const log = useLogg('electron:perf-recording').useGlobalConfig()

/**
 * Samples this stage window for the main-process perf recorder while recording is active.
 *
 * Main owns the recording state and the 5 s cadence: it pulls the window's rollup and, for an incident, its frame ring.
 * The sampler runs only between an active state and the next inactive one. While recording is active, the window tells
 * main when it loaded and, in development, on every Vite update, so main can read the running code's identity again;
 * main debounces the updates. Each pull also carries the window's `model-load` and `feature-change` events since the
 * previous pull. Tags come from settings and state stores; no chat text, model path or other personal text is read.
 */
export function initializePerfRecordingBridge(context: ReturnType<typeof getElectronEventaContext>, window: PerfStageWindow): () => void {
  const lifecycle = useStageWindowLifecycleStore()
  const settings = useSettings()
  const mmd = useMMD()
  const live2d = useSettingsLive2d()
  const speechOutput = useSpeechOutputControlStore()
  const wakeWord = useWakeWordDetectionStore()
  const hearing = useHearingStore()
  const chat = useChatStore()
  const stageSelf = useStageSelfStore()
  const motionDiagnostics = useMMDMotionDiagnostics()
  const live2dDiagnostics = useNaturalMotionDiagnostics()
  const events = new WindowPerfEvents()

  function readTags(): WindowTagSnapshot {
    const model = settings.stageModelSelectedDisplayModel
    // The visualizer's diagnostics store exists only in windows that opened it; reading its state does not create it.
    const diagnostics = getActivePinia()?.state.value[useStageThreeRuntimeDiagnosticsStore.$id]
    return resolveWindowTags({
      stageHost: window === 'stage' ? 'desktop' : 'window',
      renderer: settings.stageModelRenderer,
      model: model ? { id: model.id, fileName: model.name } : null,
      speechMuted: speechOutput.speechMuted,
      mmd: { physicsEnabled: mmd.physicsEnabled, naturalDriver: mmd.motionDriver === 'natural', roamMode: mmd.roamMode },
      live2dNaturalDriver: live2d.live2dMotionDriver === 'natural',
      wakeWordRunning: wakeWord.preparation !== 'unconfigured',
      hearing: hearing.enabled ? hearing.inputMode : false,
      performanceMode: stageSelf.performanceMode,
      chatGenerating: chat.sending,
      screen: { width: globalThis.screen.width, height: globalThis.screen.height, scale: globalThis.devicePixelRatio },
      diagnosticsTracing: diagnostics?.tracing === true,
    })
  }

  const sampler = new WindowUsageSampler({
    window,
    now: () => performance.now(),
    raf: callback => requestAnimationFrame(callback),
    cancelRaf: handle => cancelAnimationFrame(handle),
    PerformanceObserver: globalThis.PerformanceObserver,
    mmdDrain: target => motionDiagnostics.drainUsage(target),
    mmdRing: target => motionDiagnostics.copyFrameRing(target),
    tags: readTags,
    paused: () => lifecycle.stagePaused,
  })

  const getState = defineInvoke(context, perfRecordingGet)
  let active = false
  let changedBeforeRead = false

  function apply(state: PerfRecordingState) {
    active = state.active
    if (active) {
      sampler.start()
    }
    else {
      sampler.stop()
      events.clear()
    }
  }

  /** Whether the stage's model has committed its load. MMD and Live2D scenes report it in their stores; other renderers do not. */
  function modelLoaded(): boolean {
    switch (settings.stageModelRenderer) {
      case 'mmd':
        return mmd.isModelLoaded
      case 'live2d':
        return live2dDiagnostics.loadedModelId !== null
      default:
        return false
    }
  }

  // Both scenes clear their flag before they load, so a reload of the same model is a new rising edge.
  // A sync watcher sees each edge even when the clear and the load land in one tick.
  const stopModelLoad = watch(modelLoaded, (loaded, wasLoaded) => {
    if (active && loaded && !wasLoaded)
      events.modelLoaded(readTags())
  }, { flush: 'sync' })

  function reportReload() {
    if (active)
      void context.emit(perfRecordingRendererReload, undefined)
  }

  const stopChanged = context.on(perfRecordingChanged, (event) => {
    if (!event.body)
      return
    changedBeforeRead = true
    apply(event.body)
  })
  const stopPullRollup = defineInvokeHandler(context, perfRecordingPullRollup, (request) => {
    const rollup = sampler.pull()
    return rollup && events.attach(rollup, request)
  })
  const stopPullFrameRing = defineInvokeHandler(context, perfRecordingPullFrameRing, () => sampler.frameRing())

  void getState().then((state) => {
    // A change event that arrived while the read was in flight is newer than its answer.
    if (!changedBeforeRead)
      apply(state)
    reportReload()
  }).catch(error => log.withError(error).warn('Failed to read the perf recording state'))

  import.meta.hot?.on('vite:afterUpdate', reportReload)

  return () => {
    import.meta.hot?.off('vite:afterUpdate', reportReload)
    stopModelLoad()
    stopChanged()
    stopPullRollup()
    stopPullFrameRing()
    sampler.stop()
  }
}
