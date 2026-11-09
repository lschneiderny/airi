import type { OverlayState } from './desktop-overlay-polling'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia } from 'pinia'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { nextTick } from 'vue'

import DesktopOverlay from './desktop-overlay.vue'

import { createEmptyOverlayState } from './desktop-overlay-polling'

const mocks = vi.hoisted(() => ({
  getBounds: vi.fn<() => Promise<{ x: number, y: number, width: number, height: number }>>(),
}))
let publishState: ((state: OverlayState) => void) | undefined

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { electron } = await import('@proj-airi/electron-eventa')
  return {
    useElectronEventaInvoke: (event: unknown) => event === electron.window.getBounds ? mocks.getBounds : vi.fn(),
  }
})
vi.mock('./desktop-overlay-polling', async importOriginal => ({
  ...await importOriginal<typeof import('./desktop-overlay-polling')>(),
  createOverlayPollController: (options: Parameters<typeof import('./desktop-overlay-polling').createOverlayPollController>[0]) => ({
    start: () => publishState = options.onState,
    stop: () => publishState = undefined,
  }),
}))

beforeEach(() => {
  mocks.getBounds.mockReset()
  mocks.getBounds.mockResolvedValue({ x: 0, y: 0, width: 400, height: 500 })
})

async function mountOverlay(profile: 'windows' | 'macos' | 'linux-wayland' | null) {
  const pinia = createPinia()
  const capabilities = useHostCapabilitiesStore(pinia)
  if (profile)
    capabilities.set(capabilitiesForHost(profile))
  const view = await render(DesktopOverlay, { global: { plugins: [pinia] } })
  onTestFinished(() => view.unmount())
  // render() completes the onMounted bounds reply before the controller starts.
  expect(publishState).toBeTypeOf('function')
  const state: OverlayState = {
    ...createEmptyOverlayState(),
    hasSnapshot: true,
    candidates: [{
      id: 'button',
      source: 'ax',
      role: 'button',
      label: 'Target',
      confidence: 1,
      bounds: { x: 110, y: 120, width: 30, height: 40 },
    }],
    pointerIntent: {
      snappedPoint: { x: 120, y: 140 },
      candidateId: 'button',
      source: 'ax',
      confidence: 1,
      mode: 'snap',
      phase: 'preview',
    },
  }
  publishState?.(state)
  await nextTick()
  return { capabilities, state }
}

it.each([null, 'linux-wayland'] as const)('withholds all origin-based overlay markers for %s', async (profile) => {
  await mountOverlay(profile)

  expect(document.querySelector<HTMLElement>('.ghost-pointer')?.style.display).toBe('none')
  expect(document.querySelector('.candidate-box')).toBeNull()
  expect(document.querySelector('.target-box')).toBeNull()
})

it.each(['windows', 'macos'] as const)('preserves %s nonzero-origin marker, candidate and target coordinates', async (profile) => {
  mocks.getBounds.mockResolvedValue({ x: 100, y: 100, width: 400, height: 500 })
  const { capabilities, state } = await mountOverlay(null)
  expect(document.querySelector<HTMLElement>('.ghost-pointer')?.style.display).toBe('none')

  capabilities.set(capabilitiesForHost(profile))
  await nextTick()

  const pointer = document.querySelector<HTMLElement>('.ghost-pointer')
  expect([pointer?.style.display, pointer?.style.left, pointer?.style.top]).toEqual(['block', '12px', '32px'])
  for (const selector of ['.candidate-box', '.target-box']) {
    const box = document.querySelector<HTMLElement>(selector)
    expect([box?.style.left, box?.style.top, box?.style.width, box?.style.height]).toEqual(['10px', '20px', '30px', '40px'])
  }

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  publishState?.({ ...state, pointerIntent: state.pointerIntent ? { ...state.pointerIntent, phase: 'completed' } : null })
  await nextTick()
  const ripple = document.querySelector<HTMLElement>('.click-ripple')
  expect([ripple?.style.display, ripple?.style.left, ripple?.style.top]).toEqual(['block', '0px', '20px'])

  capabilities.set(capabilitiesForHost('linux-wayland'))
  await nextTick()
  expect(document.querySelector<HTMLElement>('.ghost-pointer')?.style.display).toBe('none')
  expect(document.querySelector<HTMLElement>('.click-ripple')?.style.display).toBe('none')
  expect(document.querySelector('.candidate-box')).toBeNull()
  expect(document.querySelector('.target-box')).toBeNull()
})

it('does not fabricate an origin when the bounds request fails on a live host', async () => {
  mocks.getBounds.mockRejectedValue(new Error('bounds unavailable'))

  await mountOverlay('windows')

  expect(document.querySelector<HTMLElement>('.ghost-pointer')?.style.display).toBe('none')
  expect(document.querySelector('.candidate-box')).toBeNull()
  expect(document.querySelector('.target-box')).toBeNull()
})
