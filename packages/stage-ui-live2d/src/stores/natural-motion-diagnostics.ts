import type { LivelinessReport } from '../composables/live2d/natural-motion/liveliness'
import type { NaturalTrace } from '../composables/live2d/natural-motion/trace'

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

type NaturalDiagnosticsEvent
  = | { type: 'natural-capture-request', request: NaturalCaptureRequest }
    | { type: 'natural-capture-result', result: NaturalCaptureResult, trace: NaturalTrace }
    | { type: 'natural-capture-failed', id: string, reason: string }

/** The lab offers 60, 300, and 600 s; the model refuses anything outside 1-600 s. */
const maxCaptureSeconds = 600

function downloadTrace(trace: NaturalTrace, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(trace)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
  return fileName
}

let traceSink: NaturalTraceSink = downloadTrace

/**
 * Replaces how the lab saves a captured trace. Pass `null` to restore the Blob download.
 * The sink runs in the window that asked to save, which is the lab, not the stage.
 */
export function setNaturalTraceSink(sink: NaturalTraceSink | null) {
  traceSink = sink ?? downloadTrace
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

  function settles(id: string) {
    return !pendingRequest.value || pendingRequest.value.id === id
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
  }
})
