import type { BrowserWindow } from 'electron'

import type { PerfRecordingService } from '.'
import type { createWindowContext } from '../../../libs/electron/window-context'
import type { PerfTraceCapture } from './trace'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  perfRecordingChanged,
  perfRecordingGet,
  perfRecordingRendererReload,
  perfRecordingSetEnabled,
  perfTraceCapture,
  perfTraceState,
} from '../../../../shared/eventa'
import { windowLabelFromUrl } from './window-label'

/**
 * Serves the perf recording state to one window and hears that window's reload notice.
 *
 * The notice carries no payload: `context` belongs to `window`, so the reloading window is this one, and its label
 * comes from its URL when the notice arrives.
 */
export function registerPerfRecording(
  context: ReturnType<typeof createWindowContext>['context'],
  window: BrowserWindow,
  service: Pick<PerfRecordingService, 'getState' | 'setEnabled' | 'onStateChange' | 'rendererReloaded'> & { trace: Pick<PerfTraceCapture, 'capture' | 'onStateChange'> },
): () => void {
  const disposers = [
    defineInvokeHandler(context, perfRecordingGet, () => service.getState()),
    defineInvokeHandler(context, perfRecordingSetEnabled, ({ enabled }) => service.setEnabled(enabled)),
    service.onStateChange((state) => {
      void context.emit(perfRecordingChanged, state)
    }),
    defineInvokeHandler(context, perfTraceCapture, ({ seconds }) => service.trace.capture(seconds)),
    service.trace.onStateChange((state) => {
      void context.emit(perfTraceState, state)
    }),
    context.on(perfRecordingRendererReload, () => {
      if (!window.isDestroyed())
        service.rendererReloaded(windowLabelFromUrl(window.webContents.getURL()))
    }),
  ]

  return () => disposers.forEach(dispose => dispose())
}
