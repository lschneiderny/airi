import type { CaptionChannelEvent } from '@proj-airi/stage-shared'

import { defineInvokeHandler } from '@moeru/eventa'
import { useElectronCursorAvailable, useElectronWindowBounds } from '@proj-airi/electron-vueuse'
import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import { createApp, nextTick } from 'vue'

import Caption from './caption.vue'

import { captionGetIsFollowingWindow } from '../../shared/eventa'
import { main, sendBounds, sendCursor } from '../electron-mouse.fixtures'

import 'virtual:uno.css'

defineInvokeHandler(main, captionGetIsFollowingWindow, () => true)
let pinia = createPinia()
const domInput = vi.fn()

beforeEach(async () => {
  const bodyStyle = document.body.getAttribute('style')
  // The stage layout fills the window and resets the browser's body margin.
  document.body.style.cssText = 'margin:0;width:400px;height:500px'
  // Park Chromium's pointer outside the simulated window before mounting.
  // Otherwise layout changes can deliver genuine pointerenter at its default (0,0).
  const parking = document.createElement('div')
  parking.dataset.testid = 'pointer-parking'
  parking.style.cssText = 'position:fixed;right:0;top:0;width:4px;height:4px'
  document.documentElement.append(parking)
  await page.getByTestId('pointer-parking').hover()
  domInput.mockClear()
  for (const type of ['pointerenter', 'pointerleave', 'mousemove'])
    document.body.addEventListener(type, domInput)
  onTestFinished(() => {
    for (const type of ['pointerenter', 'pointerleave', 'mousemove'])
      document.body.removeEventListener(type, domInput)
    parking.remove()
    if (bodyStyle === null)
      document.body.removeAttribute('style')
    else
      document.body.setAttribute('style', bodyStyle)
  })
  pinia = createPinia()
  setActivePinia(pinia)
  useElectronCursorAvailable()
  useElectronWindowBounds()
  await sendBounds({ x: 100, y: 200, width: 400, height: 500 })
  await sendCursor(null)
})

async function mountCaption() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(Caption).use(pinia)
  app.mount(host)
  const channel = new BroadcastChannel('airi-caption-overlay')
  onTestFinished(() => {
    channel.close()
    app.unmount()
    host.remove()
    vi.useRealTimers()
  })
  // Wait for the mounted invoke and broadcast subscription before sending text.
  await nextTick()
  channel.postMessage({ type: 'caption-speaker', text: 'Visible caption' } satisfies CaptionChannelEvent)
  await vi.waitFor(() => expect(host.textContent).toContain('Visible caption'))
  const surface = host.querySelector('.transition-opacity')
  expect(surface).toBeInstanceOf(HTMLElement)
  if (!(surface instanceof HTMLElement))
    throw new Error('Caption surface did not mount')
  return surface
}

async function settleHover(surface: HTMLElement) {
  await vi.advanceTimersByTimeAsync(250)
  await nextTick()
  surface.getAnimations().forEach(animation => animation.finish())
}

describe('caption hover visibility', () => {
  it.each([null, 'linux-wayland', 'windows', 'macos'] as const)('keeps valid text visible without pointer input on %s', async (profile) => {
    if (profile)
      useHostCapabilitiesStore().set(capabilitiesForHost(profile))
    const surface = await mountCaption()

    await settleHover(surface)

    expect(domInput).not.toHaveBeenCalled()
    expect(surface.classList.contains('op-100')).toBe(true)
    expect(surface.classList.contains('op-0')).toBe(false)
    expect(getComputedStyle(surface).opacity).toBe('1')
  })

  it('fades after a real DOM entry on Wayland and restores after exit', async () => {
    useHostCapabilitiesStore().set(capabilitiesForHost('linux-wayland'))
    const surface = await mountCaption()

    await page.elementLocator(surface).hover()
    await nextTick()
    await settleHover(surface)
    expect(surface.classList.contains('op-0')).toBe(true)
    expect(getComputedStyle(surface).opacity).toBe('0')

    await page.getByTestId('pointer-parking').hover()
    await nextTick()
    await settleHover(surface)
    expect(surface.classList.contains('op-100')).toBe(true)
  })

  it.each(['windows', 'macos'] as const)('preserves %s native hover and clears it when the reading is withheld', async (profile) => {
    useHostCapabilitiesStore().set(capabilitiesForHost(profile))
    const surface = await mountCaption()

    await sendCursor({ x: 140, y: 240 })
    await settleHover(surface)
    expect(surface.classList.contains('op-0')).toBe(true)

    await sendCursor(null)
    await settleHover(surface)
    expect(surface.classList.contains('op-100')).toBe(true)
  })
})
