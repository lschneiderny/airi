import type { StageRowInput } from './index'

import { describe, expect, it } from 'vitest'

import {
  calibrateCamera,
  dipToPlane,
  groundLineOf,
  layoutStageRow,
  nearestRowSlot,
  placementRectAt,
  screenToRowX,
  slotScreenToWorldX,
  STAGE_ROW_OFFSTAGE_MODEL_HEIGHTS,
  stageDisplayFor,
  worldToDip,
} from './index'

const laptop = { id: 'laptop', workArea: { x: 0, y: 25, width: 1440, height: 875 } }
const monitor = { id: 'monitor', workArea: { x: 1440, y: 0, width: 2560, height: 1400 } }

const character = { modelHeight: 20, characterHeightDip: 560, toeMarginDip: 8, halfWidthDip: 0.3 * 560 }
const input = (displays: StageRowInput['displays']): StageRowInput => ({ ...character, displays })
const offstage = STAGE_ROW_OFFSTAGE_MODEL_HEIGHTS * character.modelHeight

describe('layoutStageRow', () => {
  it('gives a single display the calibration and the ground line it has without a row', () => {
    const { slots } = layoutStageRow(input([laptop]))
    const calibration = calibrateCamera({
      workArea: { width: 1440, height: 875 },
      modelHeight: 20,
      characterHeightDip: 560,
      floorRowDip: 875 - 8,
    })

    expect(slots).toHaveLength(1)
    expect(slots[0]!.calibration).toEqual(calibration)
    expect(slots[0]!.ground).toEqual(groundLineOf({ width: 1440, height: 875 }, calibration, 0.3 * 560 * calibration.unitsPerDip))
  })

  it('separates neighbours by both half widths and the unseen stretch', () => {
    const [left, right] = layoutStageRow(input([monitor, laptop])).slots
    const halfWidth = character.halfWidthDip * left!.calibration.unitsPerDip

    expect([left!.id, right!.id]).toEqual(['laptop', 'monitor'])
    expect(left!.calibration.originX).toBe(0)
    expect(left!.visible.maxX).toBeCloseTo(1440 * left!.calibration.unitsPerDip + halfWidth, 9)
    expect(right!.visible.minX - left!.visible.maxX).toBeCloseTo(offstage, 9)
    expect(right!.calibration.originX - left!.visible.maxX).toBeCloseTo(offstage + halfWidth, 9)
    expect(right!.ground.minX).toBeCloseTo(right!.calibration.originX + halfWidth, 9)
  })

  it('keeps each display its own scale when a short display shrinks her', () => {
    const short = { id: 'short', workArea: { x: 1440, y: 0, width: 1920, height: 400 } }
    const [tall, squat] = layoutStageRow(input([laptop, short])).slots

    expect(tall!.calibration.unitsPerDip).toBeCloseTo(20 / 560, 12)
    expect(squat!.calibration.unitsPerDip).toBeCloseTo(20 / (0.9 * 392), 12)
    // Her half width in world units grows with the scale, and so does that side of the wing.
    const wing = squat!.calibration.originX - (tall!.calibration.originX + 1440 * tall!.calibration.unitsPerDip)
    expect(wing).toBeCloseTo(character.halfWidthDip * (tall!.calibration.unitsPerDip + squat!.calibration.unitsPerDip) + offstage, 9)
  })

  it('orders stacked displays by their vertical centre and lays them side by side', () => {
    const upper = { id: 'upper', workArea: { x: 0, y: 0, width: 1920, height: 1080 } }
    const lower = { id: 'lower', workArea: { x: 0, y: 1080, width: 1920, height: 1040 } }
    const { slots } = layoutStageRow(input([lower, upper]))

    expect(slots.map(slot => slot.id)).toEqual(['upper', 'lower'])
    expect(slots[1]!.visible.minX - slots[0]!.visible.maxX).toBeCloseTo(offstage, 9)
  })

  it('treats a gap between displays like any other wing', () => {
    const far = { id: 'far', workArea: { x: 9000, y: 0, width: 1440, height: 875 } }
    const { slots } = layoutStageRow(input([laptop, far]))

    expect(slots[1]!.visible.minX - slots[0]!.visible.maxX).toBeCloseTo(offstage, 9)
  })

  it('round-trips a point on the second display through its own camera', () => {
    const right = layoutStageRow(input([laptop, monitor])).slots[1]!
    const point = { x: 812, y: 300 }

    const back = worldToDip(right.calibration, dipToPlane(right.calibration, point, 0))
    expect(back.x).toBeCloseTo(point.x, 9)
    expect(back.y).toBeCloseTo(point.y, 9)
    expect(dipToPlane(right.calibration, { x: 0, y: right.calibration.floorRowDip }, 0).x).toBeCloseTo(right.calibration.originX, 9)
  })
})

describe('screenToRowX', () => {
  const row = layoutStageRow(input([laptop, monitor]))
  const [left, right] = row.slots

  it('maps a screen point to the world x of the display that holds it', () => {
    expect(screenToRowX(row, { x: 720, y: 400 })).toBeCloseTo(720 * left!.calibration.unitsPerDip, 9)
    expect(screenToRowX(row, { x: 1440 + 100, y: 1200 })).toBeCloseTo(right!.calibration.originX + 100 * right!.calibration.unitsPerDip, 9)
  })

  it('maps dead space to null', () => {
    // Above the laptop's work area (its menu bar), below it (beside the taller monitor), and past the last display.
    expect(screenToRowX(row, { x: 720, y: 10 })).toBeNull()
    expect(screenToRowX(row, { x: 720, y: 1200 })).toBeNull()
    expect(screenToRowX(row, { x: 5000, y: 400 })).toBeNull()
  })

  it('extrapolates a column beside the work area on a named slot', () => {
    expect(slotScreenToWorldX(right!, 1440 - 30)).toBeCloseTo(right!.calibration.originX - 30 * right!.calibration.unitsPerDip, 9)
  })

  it('finds the slot that holds a point, and the closest one for dead space', () => {
    expect(nearestRowSlot(row, { x: 2000, y: 700 })?.id).toBe('monitor')
    // Below the laptop's work area, 100 DIP from it and 720 DIP from the monitor.
    expect(nearestRowSlot(row, { x: 720, y: 1000 })?.id).toBe('laptop')
    expect(nearestRowSlot({ slots: [] }, { x: 0, y: 0 })).toBeNull()
  })
})

describe('placementRectAt', () => {
  const [left, right] = layoutStageRow(input([laptop, { id: 'short', workArea: { x: 1440, y: 0, width: 1920, height: 400 } }])).slots
  const column = (slot: typeof left, x: number) => worldToDip(slot!.calibration, { x, y: 0, z: 0 }).x
  const rootX = left!.ground.minX + 3
  // A rectangle 100 DIP left of her root column and 500 DIP above the floor row of the laptop.
  const rect = { x: column(left, rootX) - 100, y: left!.calibration.floorRowDip - 500, width: 200, height: 510 }

  it('shifts the rectangle with the root on one display', () => {
    const moved = placementRectAt(rect, { calibration: left!.calibration, rootX }, { calibration: left!.calibration, rootX: rootX + 6 })

    expect(moved.x - rect.x).toBeCloseTo(6 / left!.calibration.unitsPerDip, 9)
    expect(moved.y).toBeCloseTo(rect.y, 9)
    expect(moved.width).toBeCloseTo(200, 9)
    expect(moved.height).toBeCloseTo(510, 9)
  })

  it('lands in the other display\'s window, at the size that display draws her', () => {
    const homeX = right!.ground.minX + 2
    const scale = left!.calibration.unitsPerDip / right!.calibration.unitsPerDip
    const home = placementRectAt(rect, { calibration: left!.calibration, rootX }, { calibration: right!.calibration, rootX: homeX })

    expect(scale).toBeLessThan(1)
    expect(home.x).toBeCloseTo(column(right, homeX) - 100 * scale, 9)
    expect(home.y).toBeCloseTo(right!.calibration.floorRowDip - 500 * scale, 9)
    expect(home.width).toBeCloseTo(200 * scale, 9)
    expect(home.height).toBeCloseTo(510 * scale, 9)
  })
})

describe('stageDisplayFor', () => {
  const row = layoutStageRow(input([laptop, monitor]))
  const [left, right] = row.slots
  const unseen = (left!.visible.maxX + right!.visible.minX) / 2

  it('keeps the current display while it shows any of her', () => {
    expect(stageDisplayFor(row, 'laptop', left!.ground.minX, 1)).toBe('laptop')
    // Past the edge of the ground line but not yet a half width off the work area: her trailing side is still drawn.
    expect(stageDisplayFor(row, 'laptop', left!.visible.maxX - 0.01, 1)).toBe('laptop')
  })

  it('hands her to the neighbour once she is fully off the current display toward it', () => {
    expect(stageDisplayFor(row, 'laptop', left!.visible.maxX + 0.01, 1)).toBe('monitor')
    expect(stageDisplayFor(row, 'monitor', right!.visible.minX - 0.01, -1)).toBe('laptop')
  })

  it('follows a reversal inside the wing without flapping', () => {
    // She walked right off the laptop, the window moved to the monitor, and she keeps walking: it stays there.
    expect(stageDisplayFor(row, 'monitor', unseen, 1)).toBe('monitor')
    // She turns back in the unseen stretch: the window returns before the laptop shows her.
    expect(stageDisplayFor(row, 'monitor', unseen, -1)).toBe('laptop')
    expect(stageDisplayFor(row, 'laptop', unseen, -1)).toBe('laptop')
  })

  it('keeps a bordering current display for a root at rest in the wing', () => {
    expect(stageDisplayFor(row, 'laptop', unseen, 0)).toBe('laptop')
    expect(stageDisplayFor(row, 'monitor', unseen, 0)).toBe('monitor')
  })

  it('picks the display that shows her when the current one does not, whatever the heading', () => {
    expect(stageDisplayFor(row, 'laptop', right!.ground.minX, -1)).toBe('monitor')
    expect(stageDisplayFor(row, null, left!.ground.maxX, 0)).toBe('laptop')
    expect(stageDisplayFor(row, 'gone', unseen, 0)).toBe('laptop')
  })

  it('keeps her on the end displays beyond the row, and has no answer for an empty row', () => {
    expect(stageDisplayFor(row, 'monitor', left!.visible.minX - 50, -1)).toBe('laptop')
    expect(stageDisplayFor(row, 'laptop', right!.visible.maxX + 50, 1)).toBe('monitor')
    expect(stageDisplayFor({ slots: [] }, 'laptop', 0, 0)).toBeNull()
  })

  it('stays on the only display of a row of one wherever the root is', () => {
    const single = layoutStageRow(input([laptop]))
    for (const x of [-100, 0, 20, 500])
      expect(stageDisplayFor(single, 'laptop', x, 1)).toBe('laptop')
  })
})
