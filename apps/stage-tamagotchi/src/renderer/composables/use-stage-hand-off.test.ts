import type { StageHandOff } from './use-stage-hand-off'

import { layoutStageRow } from '@proj-airi/stage-shared/stage-world'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { stageHandOffHoldMs } from './stage-hand-off'
import { useStageHandOff } from './use-stage-hand-off'

const row = layoutStageRow({
  displays: [
    { id: 'laptop', workArea: { x: 0, y: 25, width: 1440, height: 875 } },
    { id: 'monitor', workArea: { x: 1440, y: 0, width: 2560, height: 1400 } },
  ],
  modelHeight: 20,
  characterHeightDip: 560,
  toeMarginDip: 8,
  halfWidthDip: 168,
})
const [laptop, monitor] = row.slots
/** A root in the stretch of the wing that no display shows. */
const unseenX = (laptop!.visible.maxX + monitor!.visible.minX) / 2

/** A stage page reduced to what the hand-off reads: the display under the camera, her root, and the main process. */
function setup(options: { arrives: boolean, live?: boolean }) {
  const stageDisplayId = shallowRef('laptop')
  const rootX = shallowRef<number | null>(laptop!.ground.maxX)
  const live = shallowRef(options.live ?? true)
  const moves: string[] = []
  const onWalked = vi.fn()
  const scope = effectScope()
  const handOff = scope.run(() => {
    const created: StageHandOff = useStageHandOff({
      row: () => row,
      stageSlot: () => row.slots.find(slot => slot.id === stageDisplayId.value) ?? null,
      rootX,
      live,
      // As the page does: the state of the main process is observed before the move resolves.
      move: async (displayId) => {
        moves.push(displayId)
        if (options.arrives)
          stageDisplayId.value = displayId
        created.observe(stageDisplayId.value)
        return stageDisplayId.value
      },
      onWalked,
    })
    return created
  })!
  handOff.observe('laptop')
  /** One animation frame with her root at `x`. */
  const frameAt = (x: number) => {
    rootX.value = x
    return handOff.frame({ dragging: false })
  }
  return { handOff, scope, rootX, live, moves, onWalked, frameAt }
}

afterEach(() => vi.useRealTimers())

describe('useStageHandOff', () => {
  it('moves the window after her once and leaves her root alone when the move is confirmed', async () => {
    const { handOff, scope, moves, onWalked, frameAt } = setup({ arrives: true })

    expect(frameAt(laptop!.visible.maxX - 0.01)).toBe(false)
    expect(frameAt(unseenX)).toBe(true)
    expect(handOff.moving.value).toBe(true)
    frameAt(unseenX + 0.3)
    await vi.waitFor(() => expect(handOff.moving.value).toBe(false))

    expect(moves).toEqual(['monitor'])
    expect(onWalked).toHaveBeenCalledOnce()
    expect(handOff.teleportSeq.value).toBe(0)
    expect(handOff.on.value).toBe(true)
    expect(frameAt(monitor!.ground.minX)).toBe(false)
    scope.stop()
  })

  it('brings her back and holds hand-off for a while when the move is not confirmed', async () => {
    vi.useFakeTimers()
    const { handOff, scope, moves, onWalked, frameAt } = setup({ arrives: false })

    frameAt(laptop!.ground.maxX)
    frameAt(unseenX)
    // Settles the move the fake main process answered; no time passes.
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()

    expect(handOff.on.value).toBe(false)
    expect(handOff.teleportSeq.value).toBe(1)
    expect(onWalked).not.toHaveBeenCalled()
    // Held: she is not followed again, wherever her root is.
    frameAt(unseenX + 0.3)
    expect(moves).toEqual(['monitor'])

    vi.advanceTimersByTime(stageHandOffHoldMs)
    expect(handOff.on.value).toBe(true)
    scope.stop()
  })

  it('asks for a teleport when the main process places the window by itself', () => {
    const { handOff, scope, onWalked } = setup({ arrives: true })

    handOff.observe('monitor')

    expect(handOff.teleportSeq.value).toBe(1)
    expect(onWalked).not.toHaveBeenCalled()
    scope.stop()
  })

  it('never moves the window while the host cannot vouch for the window and the cursor, or during a drag', () => {
    const blind = setup({ arrives: true, live: false })
    blind.frameAt(laptop!.ground.maxX)
    blind.frameAt(unseenX)
    expect(blind.handOff.on.value).toBe(false)
    expect(blind.moves).toEqual([])
    blind.scope.stop()

    const dragged = setup({ arrives: true })
    dragged.frameAt(laptop!.ground.maxX)
    dragged.rootX.value = unseenX
    dragged.handOff.frame({ dragging: true })
    expect(dragged.moves).toEqual([])
    // The same root moves the window once the drag has ended.
    dragged.handOff.frame({ dragging: false })
    expect(dragged.moves).toEqual(['monitor'])
    dragged.scope.stop()
  })
})
