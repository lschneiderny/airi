import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { HostCapabilities, HostFacts } from '@proj-airi/stage-shared/host-capabilities'
import type { BrowserWindow } from 'electron'

import process from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'
import { getHostCapabilities, hostCapabilitiesChanged } from '@proj-airi/electron-eventa'
import { HostReasons, idleAdvances, resolveHostCapabilities } from '@proj-airi/stage-shared/host-capabilities'
import { app } from 'electron'

import { resolveIsWayland } from '../../app/ozone'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'

type EventaContext = ReturnType<typeof createContext>['context']

const contexts = new Set<EventaContext>()
const idleSamples: Array<{ seconds: number, atMs: number }> = []
const runtimeFacts: Pick<HostFacts, 'foregroundBindingFailed' | 'globalInputHookFailure' | 'foregroundTitlesTrusted' | 'waylandIdleVerified'> = {
  foregroundBindingFailed: false,
  globalInputHookFailure: 'none',
  foregroundTitlesTrusted: null,
  waylandIdleVerified: false,
}

let facts: HostFacts | undefined
let current: HostCapabilities | undefined

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

function updateSnapshot() {
  // Native loaders can report before the first window; retain the facts without reading app APIs.
  if (!facts || !current)
    return
  Object.assign(facts, runtimeFacts)
  const next = resolveHostCapabilities(facts, Date.now())
  if (JSON.stringify(next.signals) === JSON.stringify(current.signals))
    return
  current = next
  for (const context of contexts)
    context.emit(hostCapabilitiesChanged, current)
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

/** Registers one window's invoke and change delivery until it closes or the app quits. */
export function createHostCapabilitiesService(params: { context: EventaContext, window: BrowserWindow }) {
  getCurrentHostCapabilities()
  contexts.add(params.context)
  const offGet = defineInvokeHandler(params.context, getHostCapabilities, getCurrentHostCapabilities)
  function dispose() {
    offGet()
    contexts.delete(params.context)
  }
  const offBeforeQuit = onAppBeforeQuit(dispose)
  params.window.once('closed', () => {
    dispose()
    offBeforeQuit()
  })
}
