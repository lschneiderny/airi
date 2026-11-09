import type { HostId } from '@proj-airi/stage-shared/host-capabilities'
import type { SystemAudioLipSyncOutput } from '@proj-airi/stage-ui/stores/system-audio-lipsync'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { electron } from '@proj-airi/electron-eventa'
import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Live2DSystemAudioLipSyncDriver } from './system-audio-lipsync'

const eventa = vi.hoisted(() => ({ context: undefined as unknown }))

vi.mock('@proj-airi/electron-vueuse', () => ({
  getElectronEventaContext: () => eventa.context,
}))

// Each capture is a real audio MediaStream; only the portal selection is replaced.
vi.mock('@proj-airi/electron-screen-capture/renderer', () => ({
  setupElectronScreenCapture: () => ({
    selectWithSource: async () => {
      const context = new AudioContext()
      const destination = context.createMediaStreamDestination()
      context.createOscillator().connect(destination)
      return destination.stream
    },
  }),
}))

vi.mock('@proj-airi/model-driver-lipsync', () => ({
  createLive2DLipSync: async () => ({ connectSource: () => {}, getMouthOpen: () => 0, dispose: () => {} }),
}))

/** The analyser peak the next frames read, as a fraction of full scale. */
let peak = 0
let reports: Array<{ level: number }> = []
let outputs: SystemAudioLipSyncOutput[] = []
let driver: Live2DSystemAudioLipSyncDriver
/** Called by the real output and report callbacks, so a waiter re-checks its condition on each one. */
const changes = new Set<() => void>()

function notify() {
  for (const check of [...changes])
    check()
}

/** Resolves when the condition holds after a real callback; rejects with a clear message after 5 s. */
function until(condition: () => boolean, what: string, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      if (condition()) {
        clearTimeout(timer)
        changes.delete(check)
        resolve()
      }
    }
    timer = setTimeout(() => {
      changes.delete(check)
      reject(new Error(`timed out after ${ms} ms waiting for ${what}`))
    }, ms)
    changes.add(check)
    check()
  })
}

beforeEach(() => {
  peak = 0
  reports = []
  outputs = []
  changes.clear()
  const context = createContext()
  defineInvokeHandler(context, electron.hostCapabilities.reportSystemAudioHeard, (payload) => {
    reports.push(payload)
    notify()
  })
  eventa.context = context
  vi.spyOn(AnalyserNode.prototype, 'getByteFrequencyData').mockImplementation((array: Uint8Array) => {
    array.fill(Math.round(peak * 255))
  })
  setActivePinia(createPinia())
  driver = new Live2DSystemAudioLipSyncDriver()
})

afterEach(() => {
  driver.dispose()
  vi.restoreAllMocks()
})

function useHost(host: HostId) {
  useHostCapabilitiesStore().set(capabilitiesForHost(host))
}

async function startCapture() {
  await driver.start(
    { inputVolumeThreshold: 0.08, randomCloseDelayMs: 300, randomCloseProbability: 1 },
    { onOutput: (output) => {
      outputs.push(output)
      notify()
    }, onEnded: () => {} },
  )
}

async function frames(count: number) {
  const target = outputs.length + count
  await until(() => outputs.length >= target, `${count} more lip sync outputs`)
}

describe('live2D system-audio lip sync heard report', () => {
  it.each(['linux-wayland', 'linux-xwayland', 'linux-x11'] as const)('reports once per capture on %s, only above 0.05', async (host) => {
    useHost(host)
    await startCapture()
    peak = 0.04
    await frames(10)
    expect(reports).toEqual([])

    peak = 0.5
    await until(() => reports.length >= 1, 'the first heard report')
    await frames(10)
    expect(reports).toHaveLength(1)
    expect(reports[0].level).toBeGreaterThan(0.05)

    driver.stop()
    await startCapture()
    await until(() => reports.length >= 2, 'the second heard report')
    await frames(10)
    expect(reports).toHaveLength(2)
  })

  it.each(['windows', 'macos', 'web'] as const)('never reports on %s', async (host) => {
    useHost(host)
    peak = 0.5
    await startCapture()
    await frames(20)
    expect(reports).toEqual([])
  })

  it('never reports before the host snapshot arrives', async () => {
    peak = 0.5
    await startCapture()
    await frames(20)
    expect(reports).toEqual([])
  })
})
