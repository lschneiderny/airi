import type { AffectTrace } from '@proj-airi/stage-shared/expression-performance'

import type { LivelinessReport } from '../composables/live2d/natural-motion/liveliness'
import type { NaturalTrace } from '../composables/live2d/natural-motion/trace'

import { errorMessageFrom } from '@moeru/std'
import { useEventListener } from '@vueuse/core'
import { defineStore } from 'pinia'
import { onScopeDispose, shallowRef } from 'vue'

import { naturalTraceFileName } from '../composables/live2d/natural-motion/trace'

/** A lab request for one post-physics capture. `id` correlates the request with its result. */
export interface NaturalCaptureRequest {
  id: string
  durationSeconds: number
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

/** A lab request to start an affect recording in the stage, or to export the open one. */
export interface AffectTraceRequest {
  id: string
  action: 'start' | 'export'
}

/** The stage's answer to an affect-trace request. */
export interface AffectTraceResult {
  id: string
  action: AffectTraceRequest['action']
  /** Entries in the exported trace; 0 for a started recording. */
  entries: number
  truncated: boolean
  /** Where the sink saved the exported trace, or `null` for a start or before saving. */
  savedPath: string | null
}

/** Saves an exported affect trace and returns where it went, like {@link NaturalTraceSink}. */
export type AffectTraceSink = (trace: AffectTrace, fileName: string) => string | null | Promise<string | null>

type NaturalDiagnosticsEvent
  = | { type: 'natural-capture-request', request: NaturalCaptureRequest }
    | { type: 'natural-capture-result', result: NaturalCaptureResult, trace: NaturalTrace }
    | { type: 'natural-capture-failed', id: string, reason: string }
    | { type: 'affect-trace-request', request: AffectTraceRequest }
    | { type: 'affect-trace-result', result: AffectTraceResult, trace: AffectTrace | null }
    | { type: 'affect-trace-failed', id: string, reason: string }

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
 * Affect traces use the same channel with their own request state: `affectTraceRequest` is set
 * by a lab request and cleared by the matching result or failure. The stage's performance
 * conductor starts or exports its recording and answers. The window that requested an export
 * saves the exported trace through the affect-trace sink when the result arrives.
 */
export const useNaturalMotionDiagnostics = defineStore('live2d-natural-motion-diagnostics', () => {
  // Opened with the store, not through `useBroadcastChannel`, which waits for the mounted hook
  // of the first component using the store. In the Electron stage window that hook never
  // opened the channel, so capture requests never arrived.
  const channel = typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('airi-stores-stage-ui-live2d-natural-motion-diagnostics')
  useEventListener(channel, 'message', (event: MessageEvent<NaturalDiagnosticsEvent>) => applyEvent(event.data))
  onScopeDispose(() => channel?.close())
  const pendingRequest = shallowRef<NaturalCaptureRequest | null>(null)
  const result = shallowRef<NaturalCaptureResult | null>(null)
  const trace = shallowRef<NaturalTrace | null>(null)
  const failure = shallowRef<string | null>(null)
  const affectTraceRequest = shallowRef<AffectTraceRequest | null>(null)
  const affectTraceResult = shallowRef<AffectTraceResult | null>(null)
  const affectTrace = shallowRef<AffectTrace | null>(null)
  const affectTraceFailure = shallowRef<string | null>(null)
  /** Export requests this window sent; only this window saves their traces. */
  const ownExports = new Set<string>()

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
      affectTraceFailure.value = errorMessageFrom(error) ?? 'The affect trace could not be saved.'
    }
  }

  function applyAffectTraceEvent(event: Extract<NaturalDiagnosticsEvent, { type: `affect-trace-${string}` }>) {
    if (event.type === 'affect-trace-request') {
      affectTraceRequest.value = event.request
      affectTraceFailure.value = null
      return
    }
    const id = event.type === 'affect-trace-result' ? event.result.id : event.id
    const own = ownExports.delete(id)
    if (!settlesAffectTrace(id))
      return
    affectTraceRequest.value = null
    if (event.type === 'affect-trace-failed') {
      affectTraceFailure.value = event.reason
      return
    }
    affectTraceResult.value = event.result
    if (!event.trace)
      return
    affectTrace.value = event.trace
    if (own)
      void saveAffectTrace(event.result, event.trace)
  }

  function applyEvent(event: NaturalDiagnosticsEvent) {
    if (event.type === 'affect-trace-request' || event.type === 'affect-trace-result' || event.type === 'affect-trace-failed') {
      applyAffectTraceEvent(event)
      return
    }
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

  function requestCapture(durationSeconds: number) {
    const request = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      durationSeconds: Math.min(maxCaptureSeconds, Math.max(1, durationSeconds)),
    }
    emit({ type: 'natural-capture-request', request })
    return request.id
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

  /** Asks the stage to start an affect recording or to export the open one. Returns the request id. */
  function requestAffectTrace(action: AffectTraceRequest['action']) {
    const request = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, action }
    if (action === 'export')
      ownExports.add(request.id)
    emit({ type: 'affect-trace-request', request })
    return request.id
  }

  /** Answers a request from the stage; an export passes its trace, a start passes `null`. */
  function completeAffectTrace(id: string, trace: AffectTrace | null) {
    emit({
      type: 'affect-trace-result',
      result: { id, action: trace ? 'export' : 'start', entries: trace?.entries.length ?? 0, truncated: trace?.truncated ?? false, savedPath: null },
      trace,
    })
  }

  function failAffectTrace(id: string, reason: string) {
    emit({ type: 'affect-trace-failed', id, reason })
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
  }
})
