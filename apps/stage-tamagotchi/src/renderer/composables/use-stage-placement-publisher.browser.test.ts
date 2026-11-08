import type { StageCharacterPlacement } from '../../shared/eventa'

import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import { electronStageCharacterPlacementChanged } from '../../shared/eventa'
import { useStagePlacementPublisher } from './use-stage-placement-publisher'

const mocks = vi.hoisted(() => ({ emit: vi.fn() }))

// NOTICE:
// The placement event goes to the Electron main process. The double records what the composable emits.
// Removal condition: browser tests running inside an Electron renderer.
vi.mock('@proj-airi/electron-vueuse', async () => {
  const { shallowRef } = await import('vue')
  return {
    useElectronCursorAvailable: () => shallowRef(true),
    useElectronEventaContext: () => shallowRef({ emit: mocks.emit }),
  }
})

function placementAt(x: number, overrides: Partial<StageCharacterPlacement> = {}): StageCharacterPlacement {
  return {
    displayId: '1',
    bounds: { x, y: 233, width: 300, height: 560 },
    homeBounds: { x: 500, y: 233, width: 300, height: 560 },
    ...overrides,
  }
}

async function mountPublisher() {
  mocks.emit.mockClear()
  const placement = shallowRef<StageCharacterPlacement | null>(null)
  const screen = await render(defineComponent({
    setup() {
      useStagePlacementPublisher(placement)
      return () => h('div')
    },
  }))
  onTestFinished(() => screen.unmount())
  return placement
}

function sentXs(): number[] {
  return mocks.emit.mock.calls.map(([eventa, body]) => {
    expect(eventa).toBe(electronStageCharacterPlacementChanged)
    return (body as StageCharacterPlacement).bounds.x
  })
}

describe('useStagePlacementPublisher', () => {
  it('sends nothing before the scene has measured her', async () => {
    const placement = await mountPublisher()
    placement.value = null
    await nextTick()
    expect(mocks.emit).not.toHaveBeenCalled()
  })

  it('sends the first placement and then only moves of more than 2 DIP against the last one sent', async () => {
    const placement = await mountPublisher()
    placement.value = placementAt(500)
    await nextTick()
    placement.value = placementAt(501)
    await nextTick()
    placement.value = placementAt(502)
    await nextTick()
    // 2.5 DIP from the last placement sent (500), although only 0.5 DIP from the previous frame.
    placement.value = placementAt(502.5)
    await nextTick()
    placement.value = placementAt(498.6)
    await nextTick()
    expect(sentXs()).toEqual([500, 502.5, 498.6])
  })

  it('sends when only the far edge, the home bounds or the display changes', async () => {
    const placement = await mountPublisher()
    placement.value = placementAt(500)
    await nextTick()
    placement.value = placementAt(500, { bounds: { x: 500, y: 233, width: 303, height: 560 } })
    await nextTick()
    placement.value = placementAt(500, { bounds: { x: 500, y: 233, width: 303, height: 560 }, homeBounds: { x: 800, y: 233, width: 300, height: 560 } })
    await nextTick()
    placement.value = placementAt(500, { displayId: '2', bounds: { x: 500, y: 233, width: 303, height: 560 }, homeBounds: { x: 800, y: 233, width: 300, height: 560 } })
    await nextTick()
    expect(mocks.emit).toHaveBeenCalledTimes(4)
  })
})
