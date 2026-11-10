import type { StageRow, StageRowSlot } from '@proj-airi/stage-shared/stage-world'
import type { MaybeRefOrGetter, Ref } from 'vue'

import { errorMessageFrom } from '@moeru/std'
import { computed, onScopeDispose, shallowRef, toValue, watch } from 'vue'

import { createStageHandOffState, isStageCharacterUnseen, observeStageDisplay, planStageMove, settleStageMove, stageHandOffHoldMs } from './stage-hand-off'

export interface StageHandOff {
  /** True while she may walk to another display and the window follows her. */
  on: Readonly<Ref<boolean>>
  /** True while the window is on its way to another display. */
  moving: Readonly<Ref<boolean>>
  /**
   * Counts the times she must be put on the display the window covers: the main process placed the window by itself, or
   * hand-off turned off while no display showed her, as after a crossing that failed.
   */
  teleportSeq: Readonly<Ref<number>>
  /** Records the stage display of a state from the main process, from an event or an invoke result. */
  observe: (stageDisplayId: string) => void
  /** Runs once per animation frame and starts a move when she has left the display. Returns whether no display shows her. */
  frame: (input: { dragging: boolean }) => boolean
}

/**
 * Moves the desktop stage window after the character when she walks to another display.
 *
 * Use when:
 * - The desktop stage page owns the scene; call once
 *
 * Expects:
 * - `row` holds every display; `stageSlot` is the slot of the display the window covers
 * - `live` is true only while the host vouches for both the window origin and the cursor position
 * - `move` asks the main process to move the window and resolves with the stage display afterwards. It must pass the
 *   state it received to `observe` before it resolves
 * - `onWalked` runs after each confirmed walk to another display
 *
 * A move that the main process could not confirm turns hand-off off for {@link stageHandOffHoldMs}; she is then
 * teleported back to the display the window covers.
 */
export function useStageHandOff(options: {
  row: MaybeRefOrGetter<StageRow | null>
  stageSlot: MaybeRefOrGetter<StageRowSlot | null>
  rootX: MaybeRefOrGetter<number | null>
  live: MaybeRefOrGetter<boolean>
  move: (displayId: string) => Promise<string>
  onWalked: () => void
}): StageHandOff {
  let state = createStageHandOffState()
  const moving = shallowRef(false)
  const teleportSeq = shallowRef(0)
  const held = shallowRef(false)
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  onScopeDispose(() => clearTimeout(holdTimer))

  const on = computed(() => (toValue(options.row)?.slots.length ?? 0) > 1 && !held.value && toValue(options.live))
  const unseen = () => isStageCharacterUnseen(state, toValue(options.stageSlot), toValue(options.rootX))
  watch(on, (isOn) => {
    if (!isOn && unseen())
      teleportSeq.value += 1
  })

  async function run(displayId: string) {
    moving.value = true
    let arrivedOn: string | null = null
    try {
      arrivedOn = await options.move(displayId)
    }
    catch (error) {
      console.warn('[Stage] Failed to move the stage window:', errorMessageFrom(error))
    }
    state = settleStageMove(state)
    moving.value = false
    if (arrivedOn === displayId)
      return

    console.warn(`[Stage] The stage window did not reach display ${displayId}; she stays on this display for ${stageHandOffHoldMs / 1000} s`)
    held.value = true
    clearTimeout(holdTimer)
    holdTimer = setTimeout(() => {
      held.value = false
    }, stageHandOffHoldMs)
  }

  return {
    on,
    moving,
    teleportSeq,
    observe(stageDisplayId) {
      const observed = observeStageDisplay(state, stageDisplayId)
      state = observed.state
      if (observed.change === 'placed')
        teleportSeq.value += 1
      if (observed.change === 'walked')
        options.onWalked()
    },
    frame({ dragging }) {
      // A drag never crosses, so it holds the window.
      const plan = planStageMove(state, { row: toValue(options.row), rootX: toValue(options.rootX), enabled: on.value && !dragging })
      state = plan.state
      if (plan.moveTo !== null)
        void run(plan.moveTo)
      return unseen()
    },
  }
}
