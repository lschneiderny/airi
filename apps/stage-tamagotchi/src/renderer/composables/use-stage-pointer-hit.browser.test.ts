import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, onScopeDispose, shallowRef } from 'vue'

import { useStagePointerHit } from './use-stage-pointer-hit'

const scheduler = vi.hoisted(() => ({
  callback: undefined as ((frame: { timestamp: number, delta: number }) => void) | undefined,
  running: false,
  frames: 0,
}))

vi.mock('@vueuse/core', async importOriginal => ({
  ...await importOriginal<typeof import('@vueuse/core')>(),
  useRafFn: (callback: typeof scheduler.callback) => {
    scheduler.callback = callback
    scheduler.running = false
    const pause = () => {
      scheduler.running = false
    }
    onScopeDispose(pause)
    return {
      pause,
      resume: () => {
        scheduler.running = true
      },
    }
  },
}))

async function renderStage() {
  const canvas = shallowRef<HTMLCanvasElement>()
  const covered = shallowRef(false)
  const active = shallowRef(true)
  let hit!: ReturnType<typeof useStagePointerHit>
  const screen = await render(defineComponent({
    setup() {
      hit = useStagePointerHit({
        canvas,
        cursorX: 50,
        cursorY: 50,
        active,
        readPixel: true,
        readRegion: true,
        regionRadius: 25,
        onReadback: () => {},
        fadeEnabled: true,
        renderer: 'live2d',
        threeEnabled: false,
        threeTransparent: true,
        threeExactTransparent: true,
      })
      return () => [
        h('canvas', {
          ref: (element) => {
            canvas.value = (element ?? undefined) as HTMLCanvasElement | undefined
          },
          width: 100,
          height: 100,
          style: { position: 'fixed', left: '0', top: '0', width: '100px', height: '100px' },
        }),
        covered.value ? h('div', { style: { position: 'fixed', left: '40px', top: '40px', width: '20px', height: '20px' } }) : null,
      ]
    },
  }))
  onTestFinished(() => screen.unmount())

  const gl = canvas.value!.getContext('webgl2', { preserveDrawingBuffer: true })!
  gl.enable(gl.SCISSOR_TEST)
  /** Paints the whole canvas empty, then `opaque` (x, y, width, height in canvas pixels, from the bottom left) opaque. */
  function paint(opaque?: [number, number, number, number]) {
    gl.scissor(0, 0, 100, 100)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!opaque)
      return
    gl.scissor(...opaque)
    gl.clearColor(1, 1, 1, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
  async function frame(timestamp: number) {
    await new Promise(requestAnimationFrame)
    // Complete GPU work before the controlled frame polls its fence; no wall-clock delay advances the test.
    gl.finish()
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    if (scheduler.running) {
      scheduler.frames++
      scheduler.callback?.({ timestamp, delta: 1000 / 60 })
    }
    await nextTick()
  }
  async function sample(atMs: number) {
    await frame(atMs)
    await frame(atMs + 1000 / 60)
    await frame(atMs + 2000 / 60)
  }
  await sample(0)
  return { hit, paint, covered, active, frame, sample, screen }
}

describe('useStagePointerHit', () => {
  it('re-reads the pixel under a cursor that does not move', async () => {
    // ROOT CAUSE:
    //
    // The hit test was a computed of the cursor and the canvas bounds. The drawn pixels were not a dependency, so a
    // still cursor kept the last answer after she moved or an item appeared under it, until the cursor moved again.
    const { hit, paint, sample, frame } = await renderStage()
    expect(hit.isTransparentForMouseEvents.value).toBe(true)

    paint([45, 45, 10, 10])
    await frame(99)
    expect(hit.isTransparentForMouseEvents.value).toBe(true)
    await sample(100)
    expect(hit.isTransparentForMouseEvents.value).toBe(false)
    expect(hit.isTransparent.value).toBe(false)

    paint()
    await sample(200)
    expect(hit.isTransparentForMouseEvents.value).toBe(true)
    expect(hit.isTransparent.value).toBe(true)
  })

  it('re-reads the Auto Hide region under a cursor that does not move', async () => {
    const { hit, paint, sample } = await renderStage()
    expect(hit.isTransparent.value).toBe(true)

    // 20 px left of the cursor: inside the 25 px region, outside the exact pixel.
    paint([28, 48, 4, 4])
    await sample(100)
    expect(hit.isTransparent.value).toBe(false)
    expect(hit.isTransparentForMouseEvents.value).toBe(true)
  })

  it('stops counting the canvas once interface covers the resting cursor', async () => {
    const { hit, covered, sample } = await renderStage()
    expect(hit.isTransparentForMouseEvents.value).toBe(true)

    covered.value = true
    await nextTick()
    await sample(100)
    expect(hit.isTransparentForMouseEvents.value).toBe(false)
  })

  it('cancels scheduled frames while inactive and resumes on activation', async () => {
    const { active, frame, hit, screen } = await renderStage()
    const before = scheduler.frames
    active.value = false
    expect(scheduler.running).toBe(false)
    await frame(100)
    expect(scheduler.frames).toBe(before)
    expect(hit.isTransparentForMouseEvents.value).toBe(false)
    expect(hit.isTransparent.value).toBe(true)
    active.value = true
    expect(scheduler.running).toBe(true)
    await frame(200)
    expect(scheduler.frames).toBe(before + 1)
    await screen.unmount()
    expect(scheduler.running).toBe(false)
  })
})
