import type { DarwinBinding } from './foreground-window-darwin'

import { EventEmitter } from 'node:events'

import { createContext, defineInvoke } from '@moeru/eventa'
import { electron, hostCapabilitiesChanged } from '@proj-airi/electron-eventa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const trust = vi.hoisted(() => ({ value: 0 }))

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    getAppMetrics: () => [],
    commandLine: { getSwitchValue: () => '' },
  },
}))

vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:process')>()
  return {
    default: {
      ...actual,
      platform: 'darwin',
      getSystemVersion: () => '14.2.0',
    },
  }
})

vi.mock('std-env', () => ({
  isWindows: false,
  isMacOS: true,
  isLinux: false,
}))

vi.mock('./foreground-window-darwin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./foreground-window-darwin')>()
  const binding: DarwinBinding = {
    isProcessTrusted: () => trust.value,
    readSession: () => ({ onConsole: true, locked: false }),
    withFrontApplication: read => read({
      pid: 4321,
      bundleIdentifier: 'com.apple.Safari',
      exePath: '/Applications/Safari.app/Contents/MacOS/Safari',
      terminated: false,
    }),
    readDisplays: () => ({ status: 0, displays: [] }),
    readWindows: () => [],
    createTitleReader: () => () => ({ title: 'Synthetic document', timedOut: false }),
  }
  return { ...actual, loadDarwinBinding: async () => binding }
})

describe('createForegroundWindowService on macOS facts', () => {
  beforeEach(() => {
    vi.resetModules()
    trust.value = 0
  })

  afterEach(async () => {
    await (await import('../../libs/bootkit/lifecycle')).emitAppBeforeQuit()
  })

  it('keeps sampling while window titles are untrusted and reports the trust change through the snapshot', async () => {
    const { createForegroundWindowService } = await import('./foreground-window')
    const { createHostCapabilitiesService, getCurrentHostCapabilities } = await import('./host-capabilities')
    const context = createContext()
    let changes = 0
    context.on(hostCapabilitiesChanged, () => {
      changes += 1
    })
    createHostCapabilitiesService({ context: context as never, window: new EventEmitter() as never })
    createForegroundWindowService({ context: context as never, window: { once: vi.fn() } as never })
    const sample = defineInvoke(context, electron.foregroundWindow.sample)

    await expect(sample()).resolves.toMatchObject({ exeName: 'Safari', pid: 4321, ownProcess: false, busy: 'accepts', title: '' })
    expect(getCurrentHostCapabilities().signals.foregroundWindow).toEqual({ kind: 'degraded', reason: 'macos-window-titles-untrusted' })
    expect(changes).toBe(1)

    trust.value = 1
    await expect(sample()).resolves.toMatchObject({ exeName: 'Safari', pid: 4321, title: 'Synthetic document' })
    expect(getCurrentHostCapabilities().signals.foregroundWindow).toEqual({ kind: 'live' })
    expect(changes).toBe(2)
  })

  it('stops delivering samples once the snapshot reports the foreground binding unavailable', async () => {
    const { createForegroundWindowService } = await import('./foreground-window')
    const { createHostCapabilitiesService, getCurrentHostCapabilities, reportForegroundBindingFailed } = await import('./host-capabilities')
    const context = createContext()
    createHostCapabilitiesService({ context: context as never, window: new EventEmitter() as never })
    createForegroundWindowService({ context: context as never, window: { once: vi.fn() } as never })
    const sample = defineInvoke(context, electron.foregroundWindow.sample)

    await expect(sample()).resolves.toMatchObject({ exeName: 'Safari', pid: 4321 })

    reportForegroundBindingFailed()
    expect(getCurrentHostCapabilities().signals.foregroundWindow).toEqual({ kind: 'unavailable', reason: 'foreground-binding-load-failed' })
    await expect(sample()).resolves.toBeNull()
  })
})
