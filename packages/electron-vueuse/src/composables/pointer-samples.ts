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
  let entering = false
  const onOver = (event: Event) => {
    if ((event as PointerEvent).relatedTarget === null)
      entering = true
  }
  const listener = (event: Event) => {
    const snapshot = options.snapshot()
    const entry = entering
    entering = false
    if (!shouldReportPointerSamples(snapshot))
      return
    // NOTICE:
    // XWayland's first move on entry can replay Chromium's cached position.
    // It is not fresh coordinate evidence, even when the event is trusted.
    // Source: docs/ai/adr/2026-11-09-linux-desktop-bridge.md, the XWayland re-entry paragraph
    // under "Coordinate ownership and verification".
    // Remove when Chromium's X11 entry path reliably reports the current position.
    if (entry && snapshot?.host === 'linux-xwayland')
      return
    const now = options.now()
    if (now - lastSentAt < sampleIntervalMs)
      return
    lastSentAt = now
    const { clientX, clientY } = event as MouseEvent
    options.report({ clientX, clientY, atMs: options.wallClock() })
  }
  options.target.addEventListener('pointerover', onOver, { passive: true })
  options.target.addEventListener('pointermove', listener, { passive: true })
  return () => {
    options.target.removeEventListener('pointerover', onOver)
    options.target.removeEventListener('pointermove', listener)
  }
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
