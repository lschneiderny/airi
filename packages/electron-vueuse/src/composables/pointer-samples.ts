import type { HostCapabilities } from '@proj-airi/stage-shared/host-capabilities'

import { defineInvoke } from '@moeru/eventa'
import { getHostCapabilities, hostCapabilitiesChanged, reportPointerSample } from '@proj-airi/electron-eventa'

import { getElectronEventaContext } from './use-electron-eventa-context'

export interface PointerSample {
  clientX: number
  clientY: number
  atMs: number
}

const sampleIntervalMs = 250

/**
 * Pointer samples let main check the compositor cursor against this window,
 * so they are sent only while a Linux backend's cursor is verifying or live.
 */
export function shouldReportPointerSamples(snapshot: HostCapabilities | null): boolean {
  const cursor = snapshot?.signals.cursorScreenPoint
  if (!snapshot?.linuxDesktopBackend || !snapshot.host.startsWith('linux-') || !cursor)
    return false
  return cursor.kind === 'live' || (cursor.kind === 'unavailable' && cursor.reason === 'linux-cursor-verifying')
}

export function createPointerSampleReporter(options: {
  target: EventTarget
  report: (sample: PointerSample) => void
  snapshot: () => HostCapabilities | null
  now: () => number
  wallClock: () => number
}): () => void {
  let lastSentAt = Number.NEGATIVE_INFINITY
  const listener = (event: Event) => {
    if (!shouldReportPointerSamples(options.snapshot()))
      return
    const now = options.now()
    if (now - lastSentAt < sampleIntervalMs)
      return
    lastSentAt = now
    const { clientX, clientY } = event as MouseEvent
    options.report({ clientX, clientY, atMs: options.wallClock() })
  }
  options.target.addEventListener('pointermove', listener, { passive: true })
  return () => options.target.removeEventListener('pointermove', listener)
}

let started = false

export function startPointerSampleReports() {
  if (started || typeof window === 'undefined')
    return
  started = true
  const context = getElectronEventaContext()
  let snapshot: HostCapabilities | null = null
  context.on(hostCapabilitiesChanged, (event) => {
    if (event.body)
      snapshot = event.body
  })
  // A change event that arrives before the first read is newer, so it wins.
  void defineInvoke(context, getHostCapabilities)().then((value) => {
    snapshot ??= value
  })
  const report = defineInvoke(context, reportPointerSample)
  createPointerSampleReporter({
    target: window,
    report: sample => void report(sample).catch(() => {}),
    snapshot: () => snapshot,
    now: () => performance.now(),
    wallClock: () => Date.now(),
  })
}
