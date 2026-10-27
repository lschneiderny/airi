import type { Display } from 'electron'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useElectronAllDisplays } from './use-electron-all-displays'

type Displays = Display[]

const boundary = vi.hoisted(() => ({
  getAllDisplays: vi.fn<() => Promise<Displays>>(),
  refresh: undefined as (() => void) | undefined,
}))

vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return { ...actual, defineInvoke: () => boundary.getAllDisplays }
})

vi.mock('./use-electron-eventa-context', () => ({
  useElectronEventaContext: () => shallowRef({}),
}))

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  return {
    ...actual,
    useIntervalFn: (callback: () => void) => {
      boundary.refresh = callback
    },
  }
})

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  boundary.getAllDisplays.mockReset()
  boundary.refresh = undefined
})

function deferredDisplays() {
  let resolve!: (displays: Displays) => void
  const promise = new Promise<Displays>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useElectronAllDisplays', () => {
  it('keeps the last snapshot during a refresh instead of publishing a one-frame empty list', async () => {
    const first = deferredDisplays()
    const second = deferredDisplays()
    boundary.getAllDisplays.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const scope = effectScope()
    scopes.push(scope)
    const displays = scope.run(() => useElectronAllDisplays())!
    expect(displays.value).toEqual([])

    const snapshot: Displays = [{
      id: 1,
      accelerometerSupport: 'unknown',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      colorDepth: 24,
      colorSpace: 'srgb',
      depthPerComponent: 8,
      detected: true,
      displayFrequency: 60,
      internal: false,
      label: 'Primary',
      maximumCursorSize: { width: 64, height: 64 },
      monochrome: false,
      nativeOrigin: { x: 0, y: 0 },
      rotation: 0,
      scaleFactor: 1,
      size: { width: 1920, height: 1080 },
      touchSupport: 'unknown',
      workArea: { x: 0, y: 0, width: 1920, height: 1032 },
      workAreaSize: { width: 1920, height: 1032 },
    }]
    first.resolve(snapshot)
    await first.promise
    await nextTick()
    expect(displays.value).toBe(snapshot)
    expect(displays.value.map(display => display.bounds)).toEqual([snapshot[0].bounds])

    boundary.refresh!()
    // One deterministic frame while the IPC response remains unresolved.
    await nextTick()
    expect(displays.value).toBe(snapshot)

    const updated: Displays = []
    second.resolve(updated)
    await second.promise
    await nextTick()
    expect(displays.value).toBe(updated)
  })
})
