import { bounds } from '@proj-airi/electron-eventa'
import { getElectronEventaContext, useElectronCursorAvailable, useElectronMouse, useElectronMouseEventTarget, useElectronMouseInElement, useElectronRelativeMouse, useElectronWindowBounds } from '@proj-airi/electron-vueuse'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import { main, sendBounds, sendCursor } from './electron-mouse.fixtures'

function mountMouse() {
  let state: {
    mouse: ReturnType<typeof useElectronMouse>
    relative: ReturnType<typeof useElectronRelativeMouse>
    available: ReturnType<typeof useElectronCursorAvailable>
  } | undefined
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      state = {
        mouse: useElectronMouse(),
        relative: useElectronRelativeMouse(),
        available: useElectronCursorAvailable(),
      }
      return () => null
    },
  })
  app.mount(host)
  onTestFinished(() => {
    app.unmount()
    host.remove()
  })
  if (!state)
    throw new Error('Mouse host did not mount')
  return state
}

beforeEach(async () => {
  useElectronCursorAvailable()
  useElectronWindowBounds()
  await sendBounds({ x: 0, y: 0, width: 400, height: 500 })
  await sendCursor(null)
})

describe('useElectronMouse', () => {
  it('gives a consumer that mounts while the cursor stays still the last position', async () => {
    const { mouse: first } = mountMouse()

    // The main process sends a position only when it changes, so no message follows while the cursor stays still.
    await sendCursor({ x: 10, y: 20 })
    expect(first.x.value).toBe(10)

    const { mouse: late, available } = mountMouse()
    expect(late.x.value).toBe(10)
    expect(late.y.value).toBe(20)
    expect(available.value).toBe(true)
  })

  it('marks a null body unavailable without moving either screen or relative coordinates', async () => {
    const { mouse, relative, available } = mountMouse()
    const receivedBounds = Promise.withResolvers<void>()
    getElectronEventaContext().once(bounds, () => receivedBounds.resolve())
    await main.emit(bounds, { x: 100, y: 200, width: 500, height: 500 })
    await receivedBounds.promise
    await sendCursor({ x: 140, y: 260 })
    expect(relative.available.value).toBe(true)
    expect([relative.x.value, relative.y.value]).toEqual([40, 60])
    const mousemove = vi.fn()
    const target = useElectronMouseEventTarget().value
    target.addEventListener('mousemove', mousemove)
    onTestFinished(() => target.removeEventListener('mousemove', mousemove))

    await sendCursor(null)

    expect(available.value).toBe(false)
    expect(relative.available.value).toBe(false)
    expect([mouse.x.value, mouse.y.value]).toEqual([140, 260])
    expect([relative.x.value, relative.y.value]).toEqual([40, 60])
    expect(mousemove).not.toHaveBeenCalled()
    const late = mountMouse()
    expect(late.available.value).toBe(false)
    expect([late.mouse.x.value, late.mouse.y.value]).toEqual([140, 260])
  })

  it('restores availability and coordinates when a trusted point arrives again', async () => {
    const { mouse, available } = mountMouse()
    await sendCursor({ x: 10, y: 20 })
    await sendCursor(null)

    await sendCursor({ x: -30, y: 40 })

    expect(available.value).toBe(true)
    expect([mouse.x.value, mouse.y.value]).toEqual([-30, 40])
  })
})

async function mountHitTest(position = 100) {
  const target = ref<HTMLElement>()
  let state: ReturnType<typeof useElectronMouseInElement> | undefined
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      state = useElectronMouseInElement(target)
      return () => h('div', { ref: target, style: `position:fixed;left:${position}px;top:${position}px;width:100px;height:100px` })
    },
  })
  app.mount(host)
  onTestFinished(() => {
    app.unmount()
    host.remove()
  })
  await nextTick()
  if (!state || !target.value)
    throw new Error('Hit-test host did not mount')
  return { state, target: target.value }
}

describe('useElectronMouseInElement', () => {
  it('does not invent DOM hover at the origin before input or after a native reading is withheld', async () => {
    const { state } = await mountHitTest(0)
    expect(state.isOutside.value).toBe(true)

    await sendCursor({ x: 40, y: 40 })
    expect(state.isOutside.value).toBe(false)

    await sendCursor(null)
    expect(state.isOutside.value).toBe(true)
  })

  it('retains pointer-only entry when native availability is withdrawn mid-hover', async () => {
    await sendCursor({ x: 900, y: 900 })
    const { state, target } = await mountHitTest()
    target.dispatchEvent(new PointerEvent('pointerenter', { clientX: 130, clientY: 140 }))
    await nextTick()
    expect(state.isOutside.value).toBe(true)

    await sendCursor(null)

    expect(state.isOutside.value).toBe(false)
  })

  it('uses a DOM pointerenter while withheld without changing Electron coordinates', async () => {
    const { state, target } = await mountHitTest()
    expect(state.isOutside.value).toBe(true)
    const position = [state.x.value, state.y.value]

    target.dispatchEvent(new PointerEvent('pointerenter', { clientX: 130, clientY: 140 }))
    await nextTick()

    expect(state.isOutside.value).toBe(false)
    expect([state.x.value, state.y.value]).toEqual(position)
    target.dispatchEvent(new PointerEvent('pointerleave'))
    await nextTick()
    expect(state.isOutside.value).toBe(true)
  })

  it('keeps native hit-testing authoritative while DOM reports inside', async () => {
    await sendCursor({ x: 900, y: 900 })
    const { state, target } = await mountHitTest()

    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 130, clientY: 140 }))
    target.dispatchEvent(new PointerEvent('pointerenter', { clientX: 130, clientY: 140 }))
    await nextTick()

    expect(state.isOutside.value).toBe(true)

    await sendCursor(null)
    expect(state.isOutside.value).toBe(false)
  })

  it('returns to native hit-testing when availability resumes mid-hover', async () => {
    const { state, target } = await mountHitTest()
    target.dispatchEvent(new PointerEvent('pointerenter', { clientX: 130, clientY: 140 }))
    await nextTick()
    expect(state.isOutside.value).toBe(false)

    await sendCursor({ x: 900, y: 900 })

    expect(state.isOutside.value).toBe(true)
  })

  it('retains pointer exit while native availability is still live', async () => {
    await sendCursor({ x: 900, y: 900 })
    const { state, target } = await mountHitTest()
    target.dispatchEvent(new PointerEvent('pointerenter', { clientX: 130, clientY: 140 }))
    await nextTick()
    await sendCursor(null)
    expect(state.isOutside.value).toBe(false)
    await sendCursor({ x: 900, y: 900 })

    target.dispatchEvent(new PointerEvent('pointerleave'))
    await nextTick()
    await sendCursor(null)

    expect(state.isOutside.value).toBe(true)
  })

  it('selects the current hit-test when availability flips during a DOM hover', async () => {
    await sendCursor({ x: 900, y: 900 })
    const { state, target } = await mountHitTest()
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 130, clientY: 140 }))
    await nextTick()
    expect(state.isOutside.value).toBe(true)

    await sendCursor(null)
    expect(state.isOutside.value).toBe(false)

    // The same cached native point becomes trusted again without a new DOM move.
    await sendCursor({ x: 900, y: 900 })
    expect(state.isOutside.value).toBe(true)
  })
})
