import type { StageHandOffState } from './stage-hand-off'

import { layoutStageRow } from '@proj-airi/stage-shared/stage-world'
import { describe, expect, it } from 'vitest'

import { createFollowMeState, createStageHandOffState, followCursor, followMeDwellMs, isStageCharacterUnseen, observeStageDisplay, planStageMove, settleStageMove } from './stage-hand-off'

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

function on(displayId: string): StageHandOffState {
  return observeStageDisplay(createStageHandOffState(), displayId).state
}

/** Walks the root through `xs`, one frame each, and returns the moves the page would invoke. */
function walk(state: StageHandOffState, xs: number[], enabled = true) {
  const moves: string[] = []
  let current = state
  for (const rootX of xs) {
    const plan = planStageMove(current, { row, rootX, enabled })
    current = plan.state
    if (plan.moveTo)
      moves.push(plan.moveTo)
  }
  return { state: current, moves }
}

describe('observeStageDisplay', () => {
  it('tells a confirmed walk from a window the main process placed', () => {
    const first = observeStageDisplay(createStageHandOffState(), 'laptop')
    const moving = walk(first.state, [laptop!.ground.maxX, unseenX]).state
    const walked = observeStageDisplay(moving, 'monitor')
    // The invoke result repeats the state the event already delivered.
    const repeated = observeStageDisplay(walked.state, 'monitor')
    const placed = observeStageDisplay(on('laptop'), 'monitor')

    expect(first.change).toBe('first')
    expect(walked).toMatchObject({ change: 'walked', state: { displayId: 'monitor', movingTo: 'monitor' } })
    expect(repeated.change).toBe('same')
    expect(placed.change).toBe('placed')
  })
})

describe('planStageMove', () => {
  it('asks for the neighbour once she has walked fully off the display, and only once per move', () => {
    const { state, moves } = walk(on('laptop'), [laptop!.ground.maxX, laptop!.visible.maxX - 0.01, unseenX, unseenX + 0.5])

    expect(moves).toEqual(['monitor'])
    expect(state.movingTo).toBe('monitor')
  })

  it('follows her back when she turns round in the wing after the move', () => {
    const crossed = walk(on('laptop'), [laptop!.ground.maxX, unseenX])
    const arrived = settleStageMove(observeStageDisplay(crossed.state, 'monitor').state)
    const onward = walk(arrived, [unseenX + 0.2])
    const back = walk(onward.state, [unseenX])

    expect(onward.moves).toEqual([])
    expect(back.moves).toEqual(['laptop'])
  })

  it('leaves the window alone while hand-off is off, and uses the heading it kept once it is on', () => {
    const off = walk(on('laptop'), [laptop!.ground.maxX, unseenX], false)
    const turnedOn = planStageMove(off.state, { row, rootX: unseenX, enabled: true })

    expect(off.moves).toEqual([])
    expect(turnedOn.moveTo).toBe('monitor')
  })

  it('never moves before the first host state or without a world', () => {
    expect(walk(createStageHandOffState(), [unseenX]).moves).toEqual([])
    expect(planStageMove(on('laptop'), { row: null, rootX: unseenX, enabled: true }).moveTo).toBeNull()
    expect(planStageMove(on('laptop'), { row, rootX: null, enabled: true }).moveTo).toBeNull()
  })
})

describe('isStageCharacterUnseen', () => {
  it('holds while the window moves and while her root is off the display under the camera', () => {
    const moving = walk(on('laptop'), [laptop!.ground.maxX, unseenX]).state

    expect(isStageCharacterUnseen(on('laptop'), laptop!, laptop!.ground.maxX)).toBe(false)
    expect(isStageCharacterUnseen(on('laptop'), laptop!, laptop!.visible.maxX - 0.01)).toBe(false)
    expect(isStageCharacterUnseen(on('laptop'), laptop!, unseenX)).toBe(true)
    expect(isStageCharacterUnseen(moving, laptop!, laptop!.ground.maxX)).toBe(true)
    expect(isStageCharacterUnseen(settleStageMove(moving), monitor!, monitor!.ground.minX)).toBe(false)
  })
})

describe('followCursor', () => {
  /** Runs one frame per entry and returns the displays named along the way. */
  function frames(entries: Array<{ nowMs: number, cursorDisplayId: string | null }>, homeDisplayId = 'laptop') {
    let state = createFollowMeState()
    const named: string[] = []
    for (const entry of entries) {
      const next = followCursor(state, { ...entry, homeDisplayId })
      state = next.state
      if (next.rehomeTo)
        named.push(next.rehomeTo)
    }
    return named
  }

  it('names the display the cursor has stayed on for the whole wait, once', () => {
    expect(frames([
      { nowMs: 0, cursorDisplayId: 'monitor' },
      { nowMs: followMeDwellMs - 1, cursorDisplayId: 'monitor' },
    ])).toEqual([])
    expect(frames([
      { nowMs: 0, cursorDisplayId: 'monitor' },
      { nowMs: followMeDwellMs, cursorDisplayId: 'monitor' },
      { nowMs: followMeDwellMs + 16, cursorDisplayId: 'monitor' },
    ])).toEqual(['monitor'])
  })

  it('starts the wait again when the cursor leaves the display or is lost', () => {
    expect(frames([
      { nowMs: 0, cursorDisplayId: 'monitor' },
      { nowMs: 20_000, cursorDisplayId: 'laptop' },
      { nowMs: 21_000, cursorDisplayId: 'monitor' },
      { nowMs: 40_000, cursorDisplayId: null },
      { nowMs: 41_000, cursorDisplayId: 'monitor' },
      { nowMs: 60_000, cursorDisplayId: 'monitor' },
    ])).toEqual([])
  })

  it('never names the home display or an unknown one', () => {
    expect(frames([{ nowMs: 0, cursorDisplayId: 'laptop' }, { nowMs: 90_000, cursorDisplayId: 'laptop' }])).toEqual([])
    expect(frames([{ nowMs: 0, cursorDisplayId: null }, { nowMs: 90_000, cursorDisplayId: null }])).toEqual([])
  })
})
