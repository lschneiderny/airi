import type { AffectTrace, AffectTraceFailureCode, AffectTraceRequest, AffectTraceResult } from '@proj-airi/stage-shared/expression-performance'
import type { ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'

import type { EmotionHold } from '../composables/live2d/expression/hold'
import type { NaturalChatInput } from '../composables/live2d/natural-motion'
import type { LivelinessReport } from '../composables/live2d/natural-motion/liveliness'
import type { PostureHome } from '../composables/live2d/natural-motion/posture'
import type { NaturalTrace } from '../composables/live2d/natural-motion/trace'
import type { Live2DTouchDebugSnapshot } from '../composables/live2d/touch-debug'

import { defineEventa } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { affectTraceCompletedEvent, affectTraceFailedEvent, affectTraceRequestedEvent, createAffectTraceDiagnosticsContext } from '@proj-airi/stage-shared/expression-performance'
import { defineStore } from 'pinia'
import { onScopeDispose, readonly, shallowRef } from 'vue'

import { naturalTraceFileName } from '../composables/live2d/natural-motion/trace'

/** A lab request for one post-physics capture. `id` correlates the request with its result. */
export interface NaturalCaptureRequest {
  id: string
  durationSeconds: number
  /** Rig-specific parameters the trace records beside the standard ones; see `NaturalTraceRecorderOptions`. */
  extraParameterIds?: string[]
}

/** Stamps a scenario event into the capture running in this window. */
export type NaturalCaptureMarker = (event: ScenarioEvent) => void

/** What the stage's model performs right now. Read on demand by the dev-only motion QA bridge in the same window. */
export interface NaturalStageSnapshot {
  /** Whether the Natural driver composes the model: a model is loaded, the driver is Natural, and the stage is not paused. */
  naturalActive: boolean
  /** The emotion the Natural layer holds, or `null` when none is held. */
  hold: EmotionHold | null
  /** Unscaled face-feature cursor unit in viewport CSS pixels, when the canvas has geometry. */
  head?: { x: number, y: number, width: number, height: number } | null
}

/** What the stage's model last handed to Natural as chat input, reduced to flags and counters for QA readout. */
export interface NaturalChatSummary {
  /** The chat is visible and placed, so Natural has a point to look at. */
  hasTarget: boolean
  typing: boolean
  sentSeq: number
  unfoldSeq: number
}

/** Compact capture outcome the lab renders. */
export interface NaturalCaptureResult {
  id: string
  report: LivelinessReport
  /** Where the trace sink saved the trace, or `null` until the user saves it. */
  savedPath: string | null
  frames: number
}

/**
 * Saves a captured trace and returns where it went, or `null` when nothing was saved.
 * The default sink downloads a JSON Blob, so the returned path is the download file name.
 */
export type NaturalTraceSink = (trace: NaturalTrace, fileName: string) => string | null | Promise<string | null>

/** Saves an exported affect trace and returns where it went, like {@link NaturalTraceSink}. */
export type AffectTraceSink = (trace: AffectTrace, fileName: string) => string | null | Promise<string | null>

/** Raw Natural capture messages. The affect-trace messages are Eventa events on the same channel. */
type NaturalDiagnosticsEvent
  = | { type: 'natural-capture-request', request: NaturalCaptureRequest }
    | { type: 'natural-capture-result', result: NaturalCaptureResult, trace: NaturalTrace }
    | { type: 'natural-capture-failed', id: string, reason: string }

const naturalDiagnosticsEventTypes = new Set<unknown>(['natural-capture-request', 'natural-capture-result', 'natural-capture-failed'] satisfies NaturalDiagnosticsEvent['type'][])

function isNaturalDiagnosticsEvent(data: unknown): data is NaturalDiagnosticsEvent {
  return typeof data === 'object' && data !== null && 'type' in data && naturalDiagnosticsEventTypes.has(data.type)
}

/** The lab turns the stage's touch-region overlay on or off. Not persisted: a reloaded stage starts with it off. */
export const touchOverlaySetEvent = defineEventa<{ enabled: boolean }>('eventa:event:live2d:natural-motion-diagnostics:touch-overlay:set')
/** The stage reports its touch regions and pet measurements about ten times a second while the overlay is on. */
export const touchOverlaySnapshotEvent = defineEventa<Live2DTouchDebugSnapshot>('eventa:event:live2d:natural-motion-diagnostics:touch-overlay:snapshot')

/** The lab offers 60, 300, and 600 s; the model refuses anything outside 1-600 s. */
const maxCaptureSeconds = 600

function downloadJson(value: unknown, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
  return fileName
}

let traceSink: NaturalTraceSink = downloadJson
let affectTraceSink: AffectTraceSink = downloadJson

/**
 * Replaces how the lab saves a captured trace. Pass `null` to restore the Blob download.
 * The sink runs in the window that asked to save, which is the lab, not the stage.
 */
export function setNaturalTraceSink(sink: NaturalTraceSink | null) {
  traceSink = sink ?? downloadJson
}

/**
 * Replaces how the lab saves an exported affect trace. Pass `null` to restore the Blob download.
 * The sink runs in the window that requested the export.
 */
export function setAffectTraceSink(sink: AffectTraceSink | null) {
  affectTraceSink = sink ?? downloadJson
}

/** Names an exported affect trace by its export time. */
export function affectTraceFileName(exportedAt: Date) {
  return `affect-trace-${exportedAt.toISOString().replaceAll(':', '-')}.json`
}

/**
 * Carries Natural trace captures between the devtools lab and the stage window.
 *
 * State model: `pendingRequest` is set by a request and cleared by the matching result or
 * failure. The stage's Model watches it, samples for the requested duration, and answers with
 * `completeCapture` or `failCapture`; no window samples while no request is pending. A result
 * carries the full trace (600 s at 30 Hz is about 2 MB), which BroadcastChannel can clone.
 * Results and failures for an id other than the pending one are stale and only replace the
 * shown result when no newer request is waiting.
 *
 * Affect traces use the same channel with their own request state, carried as the Eventa
 * events defined in `@proj-airi/stage-shared/expression-performance`: `affectTraceRequest` is
 * set by a lab request and cleared by the matching result or failure. The stage's performance
 * conductor starts or exports its recording and answers. The window that requested an export
 * saves the exported trace through the affect-trace sink when the result arrives. Failures are
 * {@link AffectTraceFailureCode} values, which the lab translates.
 *
 * The touch-region overlay uses two more Eventa events on the channel. The lab sets
 * `touchOverlayEnabled` for every window; the stage draws the overlay while it is on and
 * publishes `touchOverlaySnapshot`. Snapshots arriving while this window has the overlay off
 * are dropped, so one already in flight cannot show stale regions after the lab turns it off.
 */
export const useNaturalMotionDiagnostics = defineStore('live2d-natural-motion-diagnostics', () => {
  // Opened with the store, not through `useBroadcastChannel`, which waits for the mounted hook
  // of the first component using the store. In the Electron stage window that hook never
  // opened the channel, so capture requests never arrived.
  const channel = typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('airi-stores-stage-ui-live2d-natural-motion-diagnostics')
  // NOTICE:
  // Raw capture messages share this channel, so this earlier listener stops them before Eventa.
  // The Eventa adapter logs a parse error for every non-Eventa message.
  // Source: `restoreInner` in node_modules/@moeru/eventa/dist/internal-*.mjs.
  // Remove when the capture messages use Eventa contracts.
  function onRawMessage(event: MessageEvent<unknown>) {
    if (!isNaturalDiagnosticsEvent(event.data))
      return
    event.stopImmediatePropagation()
    applyEvent(event.data)
  }
  channel?.addEventListener('message', onRawMessage)
  const { context, dispose } = createAffectTraceDiagnosticsContext(channel)
  onScopeDispose(() => {
    dispose()
    channel?.removeEventListener('message', onRawMessage)
    channel?.close()
  })
  const pendingRequest = shallowRef<NaturalCaptureRequest | null>(null)
  const result = shallowRef<NaturalCaptureResult | null>(null)
  const trace = shallowRef<NaturalTrace | null>(null)
  const failure = shallowRef<string | null>(null)
  const affectTraceRequest = shallowRef<AffectTraceRequest | null>(null)
  const affectTraceResult = shallowRef<AffectTraceResult | null>(null)
  const affectTrace = shallowRef<AffectTrace | null>(null)
  const affectTraceFailure = shallowRef<AffectTraceFailureCode | null>(null)
  const touchOverlayEnabled = shallowRef(false)
  const touchOverlaySnapshot = shallowRef<Live2DTouchDebugSnapshot | null>(null)
  /** Export requests this window sent; only this window saves their traces. */
  const ownExports = new Set<string>()
  /** Set by the stage's model while its capture runs; never shared with other windows. */
  let captureMarker: NaturalCaptureMarker | null = null
  /** Registered by the stage's model while it is mounted; never shared with other windows. */
  let stageReader: (() => NaturalStageSnapshot) | null = null
  /** Id of the model whose load committed in this window's stage, or `null` while none is loaded. Never shared. */
  const loadedModelId = shallowRef<string | null>(null)
  /** In-window posture selection. Not persisted or broadcast; normal stages retain the product home. */
  const postureHome = shallowRef<PostureHome>('product')
  /**
   * In-window QA override of the Natural screen placement. `undefined` keeps the host signal, a number replaces it,
   * and `null` forces no placement signal. Not persisted or broadcast.
   */
  const placementOverride = shallowRef<number | null | undefined>(undefined)
  /** Placement the stage's model handed to Natural on its latest composition, `null` without a signal. */
  const lastPlacement = shallowRef<number | null>(null)
  /** Normalized head-X placement term the Natural controller applied in its latest step. */
  const lastPlacementYawBias = shallowRef(0)

  /**
   * In-window QA override of the Natural chat input. `undefined` keeps the host signal, an object replaces it, and
   * `null` forces no chat signal. Not persisted or broadcast.
   */
  const chatOverride = shallowRef<NaturalChatInput | null | undefined>(undefined)
  /** Summary of the chat input the stage's model handed to Natural on its latest composition; never chat text. */
  const lastChat = shallowRef<NaturalChatSummary | null>(null)

  /** The stage's model reports the chat input it handed to Natural. */
  function reportChat(chat: NaturalChatInput | null) {
    const current = lastChat.value
    // Reported every composition; a new object only when a field changes keeps watchers quiet.
    if (chat === null) {
      lastChat.value = null
      return
    }
    const hasTarget = chat.target !== null
    if (current && current.hasTarget === hasTarget && current.typing === chat.typing && current.sentSeq === chat.sentSeq && current.unfoldSeq === chat.unfoldSeq)
      return
    lastChat.value = { hasTarget, typing: chat.typing, sentSeq: chat.sentSeq, unfoldSeq: chat.unfoldSeq }
  }

  /** The stage's model reports what it handed to Natural and the yaw bias the controller applied. */
  function reportPlacement(placement: number | null, yawBias: number) {
    lastPlacement.value = placement
    lastPlacementYawBias.value = yawBias
  }

  function setPostureHome(home: PostureHome) {
    postureHome.value = home
  }

  function settles(id: string) {
    return !pendingRequest.value || pendingRequest.value.id === id
  }

  function settlesAffectTrace(id: string) {
    return !affectTraceRequest.value || affectTraceRequest.value.id === id
  }

  async function saveAffectTrace(result: AffectTraceResult, trace: AffectTrace) {
    try {
      const savedPath = await affectTraceSink(trace, affectTraceFileName(new Date()))
      if (affectTraceResult.value?.id === result.id)
        affectTraceResult.value = { ...result, savedPath }
    }
    catch (error) {
      console.error('[natural-motion-diagnostics] The affect trace could not be saved:', errorMessageFrom(error) ?? 'unknown error')
      affectTraceFailure.value = 'save-failed'
    }
  }

  context.on(affectTraceRequestedEvent, ({ body }) => {
    if (!body)
      return
    affectTraceRequest.value = body
    affectTraceFailure.value = null
  })

  context.on(affectTraceCompletedEvent, ({ body }) => {
    if (!body)
      return
    const own = ownExports.delete(body.result.id)
    if (!settlesAffectTrace(body.result.id))
      return
    affectTraceRequest.value = null
    affectTraceResult.value = body.result
    if (!body.trace)
      return
    affectTrace.value = body.trace
    if (own)
      void saveAffectTrace(body.result, body.trace)
  })

  context.on(affectTraceFailedEvent, ({ body }) => {
    if (!body)
      return
    ownExports.delete(body.id)
    if (!settlesAffectTrace(body.id))
      return
    affectTraceRequest.value = null
    affectTraceFailure.value = body.code
  })

  context.on(touchOverlaySetEvent, ({ body }) => {
    if (!body)
      return
    touchOverlayEnabled.value = body.enabled
    if (!body.enabled)
      touchOverlaySnapshot.value = null
  })

  context.on(touchOverlaySnapshotEvent, ({ body }) => {
    if (!body || !touchOverlayEnabled.value)
      return
    touchOverlaySnapshot.value = body
  })

  /** Turns the stage's touch-region overlay on or off in every window. */
  function setTouchOverlay(enabled: boolean) {
    void context.emit(touchOverlaySetEvent, { enabled })
  }

  /** The stage publishes its current touch regions; other windows show them in the lab. */
  function publishTouchOverlaySnapshot(snapshot: Live2DTouchDebugSnapshot) {
    void context.emit(touchOverlaySnapshotEvent, snapshot)
  }

  function applyEvent(event: NaturalDiagnosticsEvent) {
    if (event.type === 'natural-capture-request') {
      pendingRequest.value = event.request
      failure.value = null
      return
    }
    if (event.type === 'natural-capture-result') {
      if (!settles(event.result.id))
        return
      pendingRequest.value = null
      result.value = event.result
      trace.value = event.trace
      return
    }
    if (!settles(event.id))
      return
    pendingRequest.value = null
    failure.value = event.reason
  }

  function emit(event: NaturalDiagnosticsEvent) {
    applyEvent(event)
    channel?.postMessage(event)
  }

  function requestCapture(durationSeconds: number, options: { extraParameterIds?: readonly string[] } = {}) {
    const request: NaturalCaptureRequest = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      durationSeconds: Math.min(maxCaptureSeconds, Math.max(1, durationSeconds)),
    }
    if (options.extraParameterIds)
      request.extraParameterIds = [...options.extraParameterIds]
    emit({ type: 'natural-capture-request', request })
    return request.id
  }

  /** The stage's model registers its running capture here and clears it with `null` when the capture stops. */
  function setCaptureMarker(marker: NaturalCaptureMarker | null) {
    captureMarker = marker
  }

  /**
   * Stamps a scenario event into the capture that runs in this window, on the same clock as its samples.
   * In-window only: the event is not broadcast. Returns `false` when no capture runs here.
   */
  function markCaptureEvent(event: ScenarioEvent) {
    if (!captureMarker)
      return false
    captureMarker(event)
    return true
  }

  /** The stage's model reports each committed load, and `null` when its model goes away. */
  function setLoadedModelId(id: string | null) {
    loadedModelId.value = id
  }

  /** The stage's model registers how to read what it performs. The returned release clears only its own reader. */
  function registerStageReader(reader: () => NaturalStageSnapshot) {
    stageReader = reader
    return () => {
      if (stageReader === reader)
        stageReader = null
    }
  }

  /** What the stage's model in this window performs now, or `null` when no model is mounted here. */
  function stageSnapshot() {
    return stageReader?.() ?? null
  }

  function completeCapture(id: string, capturedTrace: NaturalTrace, report: LivelinessReport) {
    emit({
      type: 'natural-capture-result',
      result: { id, report, savedPath: null, frames: capturedTrace.t.length },
      trace: capturedTrace,
    })
  }

  function failCapture(id: string, reason: string) {
    emit({ type: 'natural-capture-failed', id, reason })
  }

  /** Abandons the pending capture; the stage stops sampling when it sees the failure. */
  function cancelCapture() {
    if (pendingRequest.value)
      failCapture(pendingRequest.value.id, 'cancelled')
  }

  /**
   * Asks the stage to start an affect recording or to export the open one. Returns the request id.
   * Listeners in this window run before the request leaves it, so the request is pending on return.
   */
  function requestAffectTrace(action: AffectTraceRequest['action']) {
    const request = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, action }
    if (action === 'export')
      ownExports.add(request.id)
    void context.emit(affectTraceRequestedEvent, request)
    return request.id
  }

  /** Answers a request from the stage; an export passes its trace, a start passes `null`. */
  function completeAffectTrace(id: string, trace: AffectTrace | null) {
    void context.emit(affectTraceCompletedEvent, {
      result: { id, action: trace ? 'export' : 'start', entries: trace?.entries.length ?? 0, truncated: trace?.truncated ?? false, savedPath: null },
      trace,
    })
  }

  function failAffectTrace(id: string, code: AffectTraceFailureCode) {
    void context.emit(affectTraceFailedEvent, { id, code })
  }

  /** Saves the shown trace through the registered sink and records the returned path locally. */
  async function saveTrace() {
    const current = result.value
    const captured = trace.value
    if (!current || !captured)
      return null
    const savedPath = await traceSink(captured, naturalTraceFileName(captured.meta))
    if (result.value?.id === current.id)
      result.value = { ...current, savedPath }
    return savedPath
  }

  return {
    pendingRequest,
    result,
    trace,
    failure,
    requestCapture,
    setCaptureMarker,
    markCaptureEvent,
    loadedModelId,
    postureHome,
    setPostureHome,
    placementOverride,
    lastPlacement: readonly(lastPlacement),
    lastPlacementYawBias: readonly(lastPlacementYawBias),
    reportPlacement,
    chatOverride,
    lastChat: readonly(lastChat),
    reportChat,
    setLoadedModelId,
    registerStageReader,
    stageSnapshot,
    completeCapture,
    failCapture,
    cancelCapture,
    saveTrace,
    affectTraceRequest,
    affectTraceResult,
    affectTrace,
    affectTraceFailure,
    requestAffectTrace,
    completeAffectTrace,
    failAffectTrace,
    touchOverlayEnabled,
    touchOverlaySnapshot,
    setTouchOverlay,
    publishTouchOverlaySnapshot,
  }
})
