import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { HostCapabilities, HostFacts, LinuxDesktopFacts } from '@proj-airi/stage-shared/host-capabilities'
import type { BrowserWindow } from 'electron'

import process from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'
import { getHostCapabilities, hostCapabilitiesChanged, reportPointerSample, reportSystemAudioHeard } from '@proj-airi/electron-eventa'
import { HostReasons, idleAdvances, resolveHostCapabilities } from '@proj-airi/stage-shared/host-capabilities'
import { app } from 'electron'

import { resolveIsWayland } from '../../app/ozone'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { onWindowClosed } from '../../libs/electron/on-window-closed'
import { hasLinuxClickThroughToggle } from '../linux-desktop/detect'

type EventaContext = ReturnType<typeof createContext>['context']
type PointerSampleSink = (window: BrowserWindow, sample: { clientX: number, clientY: number, atMs: number }) => void

const contexts = new Set<EventaContext>()
const changeListeners = new Set<(capabilities: HostCapabilities) => void>()
let pointerSampleSink: PointerSampleSink | undefined
const idleSamples: Array<{ seconds: number, atMs: number }> = []
const runtimeFacts: Pick<HostFacts, 'foregroundBindingFailed' | 'globalInputHookFailure' | 'foregroundTitlesTrusted' | 'waylandIdleVerified' | 'linuxDesktop'> = {
  foregroundBindingFailed: false,
  globalInputHookFailure: 'none',
  foregroundTitlesTrusted: null,
  waylandIdleVerified: false,
  linuxDesktop: null,
}

let facts: HostFacts | undefined
let current: HostCapabilities | undefined

function initialLinuxDesktopFacts(): LinuxDesktopFacts {
  return {
    backend: 'none',
    bridge: 'starting',
    foregroundVerified: false,
    cursorVerified: false,
    geometryVerified: false,
    keepAboveVerified: false,
    lockSource: null,
    portalShortcuts: 'absent',
    bridgeFailure: null,
    clickThroughToggle: hasLinuxClickThroughToggle(process.versions.electron),
    systemAudioVerified: false,
  }
}

/** Reads the process-wide snapshot, initializing host facts only after Electron is ready. */
export function getCurrentHostCapabilities(): HostCapabilities {
  if (current)
    return current
  if (!app.isReady())
    throw new Error('Host capabilities require app readiness')

  const platform = process.platform
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux')
    throw new Error(`Unsupported Electron host: ${platform}`)

  const [major = 0, minor = 0] = platform === 'darwin' ? process.getSystemVersion().split('.').map(Number) : []
  if (platform === 'linux')
    runtimeFacts.linuxDesktop ??= initialLinuxDesktopFacts()
  facts = {
    platform,
    waylandSession: resolveIsWayland({ env: process.env }),
    waylandOzone: resolveIsWayland({
      explicitOzonePlatform: app.commandLine.getSwitchValue('ozone-platform'),
      ozonePlatformHint: app.commandLine.getSwitchValue('ozone-platform-hint'),
      env: process.env,
    }),
    macosMajorMinor: platform === 'darwin' ? [major, minor] : null,
    ...runtimeFacts,
  }
  current = resolveHostCapabilities(facts, Date.now())
  return current
}

/** Main-process consumers that cache a reading re-read it when a status changes. */
export function onHostCapabilitiesChange(listener: (capabilities: HostCapabilities) => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

/** The coordinate provider receives renderer pointer samples; without one they are acknowledged and dropped. */
export function setPointerSampleSink(sink: PointerSampleSink | undefined) {
  pointerSampleSink = sink
}

function updateSnapshot() {
  // Native loaders can report before the first window; retain the facts without reading app APIs.
  if (!facts || !current)
    return
  Object.assign(facts, runtimeFacts)
  const next = resolveHostCapabilities(facts, Date.now())
  if (next.linuxDesktopBackend === current.linuxDesktopBackend && JSON.stringify(next.signals) === JSON.stringify(current.signals))
    return
  current = next
  for (const listener of changeListeners)
    listener(current)
  for (const context of contexts)
    context.emit(hostCapabilitiesChanged, current)
}

/** Process-local evidence; compositor restarts revoke their own verification facts. */
export function reportLinuxDesktop(patch: Partial<LinuxDesktopFacts>) {
  if (process.platform !== 'linux')
    return
  runtimeFacts.linuxDesktop = { ...(runtimeFacts.linuxDesktop ?? initialLinuxDesktopFacts()), ...patch }
  updateSnapshot()
}

export function reportForegroundBindingFailed() {
  runtimeFacts.foregroundBindingFailed = true
  updateSnapshot()
}

export function reportGlobalInputHookFailure(kind: HostFacts['globalInputHookFailure']) {
  runtimeFacts.globalInputHookFailure = kind
  updateSnapshot()
}

export function reportForegroundTitleTrust(trusted: boolean) {
  runtimeFacts.foregroundTitlesTrusted = trusted
  updateSnapshot()
}

/** Consumes renderer-driven idle polls; verification is permanent for this process. */
export function recordWaylandIdleSample(seconds: number, atMs: number) {
  const idle = current?.signals.systemIdleTime
  if (current?.host !== 'linux-wayland' || idle?.kind !== 'unavailable' || idle.reason !== HostReasons.WaylandIdleUnverified)
    return
  idleSamples.push({ seconds, atMs })
  if (idleSamples.length > 60)
    idleSamples.shift()
  if (idleSamples.some((_, index) => idleAdvances(idleSamples.slice(index)))) {
    runtimeFacts.waylandIdleVerified = true
    idleSamples.length = 0
    updateSnapshot()
  }
}

/**
 * A capture that heard audio proves Linux system-audio capture for this process.
 * The proof is never persisted, so a restart starts degraded again.
 */
export function recordSystemAudioHeard(level: number) {
  if (Number.isFinite(level) && level > 0.05)
    reportLinuxDesktop({ systemAudioVerified: true })
}

/** Registers one window's invoke and change delivery until it closes or the app quits. */
export function createHostCapabilitiesService(params: { context: EventaContext, window: BrowserWindow }) {
  getCurrentHostCapabilities()
  contexts.add(params.context)
  const offGet = defineInvokeHandler(params.context, getHostCapabilities, getCurrentHostCapabilities)
  // Receipt alone is never evidence: the coordinate provider compares each
  // pointer sample with the compositor.
  const offPointer = defineInvokeHandler(params.context, reportPointerSample, (sample) => {
    if (sample)
      pointerSampleSink?.(params.window, sample)
  })
  const offAudio = defineInvokeHandler(params.context, reportSystemAudioHeard, ({ level }) => recordSystemAudioHeard(level))
  function dispose() {
    offGet()
    offPointer()
    offAudio()
    contexts.delete(params.context)
  }
  const offBeforeQuit = onAppBeforeQuit(dispose)
  onWindowClosed(params.window, () => {
    dispose()
    offBeforeQuit()
  })
}
