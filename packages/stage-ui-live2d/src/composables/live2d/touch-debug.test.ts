import type { Live2DTouchDebugInput } from './touch-debug'

import { Matrix } from '@pixi/math'
import { describe, expect, it } from 'vitest'

import { buildLive2DTouchDebug } from './touch-debug'
import { live2DPetExitZoneRect, live2DPetThresholds, live2DPetZoneRect, Live2DTouchGestures } from './touch-gestures'

function input(overrides: Partial<Live2DTouchDebugInput> = {}): Live2DTouchDebugInput {
  return {
    modelId: 'fixture-model',
    capturedAt: new Date('2026-10-24T12:00:00.000Z'),
    nowMs: 1000,
    source: 'face',
    drawables: { face: 47, eyes: 35, physics: 210 },
    headScale: 1.25,
    touch: { x: 100, y: 100, width: 200, height: 300 },
    cursorUnit: { x: 100, y: 200, width: 200, height: 200 },
    body: { x: 0, y: 0, width: 600, height: 1200 },
    eyeAnchor: { x: 200, y: 260 },
    pointer: { x: 150, y: 150, atMs: 960 },
    hostCursorGlobal: { x: 400, y: 200 },
    gesture: new Live2DTouchGestures().inspect(1000),
    // Model canvas -> layout halves, then layout -> world doubles and shifts by (10, 20).
    internalModelLocalTransform: new Matrix(0.5, 0, 0, 0.5, 0, 0),
    modelWorldTransform: new Matrix(2, 0, 0, 2, 10, 20),
    // The backing store is twice the CSS size, as at a 2x render scale.
    canvasClient: { left: 5, top: 7, width: 400, height: 300 },
    canvasBacking: { width: 800, height: 600 },
    ...overrides,
  }
}

describe('live2d touch debug', () => {
  it('maps every region from model units to viewport pixels through the stage transforms', () => {
    const { snapshot, overlay } = buildLive2DTouchDebug(input())

    // Canvas (100, 100) -> layout (50, 50) -> world (110, 120) -> CSS (55, 60) + client origin.
    expect(snapshot.viewport.touch).toEqual({ x: 60, y: 67, width: 100, height: 150 })
    expect(snapshot.viewport.eyeAnchor).toEqual({ x: 110, y: 147 })
    expect(snapshot.model.zone).toEqual(live2DPetZoneRect({ x: 100, y: 100, width: 200, height: 300 }))
    expect(snapshot.viewport.zone).toEqual({ x: 10, y: 17, width: 200, height: 215 })
    expect(snapshot.model.exitZone).toEqual(live2DPetExitZoneRect({ x: 100, y: 100, width: 200, height: 300 }))
    expect(snapshot.viewport.exitZone).toEqual({ x: -40, y: -33, width: 300, height: 310 })
    expect(overlay.regions).toEqual(snapshot.viewport)
  })

  it('places the pointer and host cursor in viewport pixels and names the region under the pointer', () => {
    const { snapshot, overlay } = buildLive2DTouchDebug(input())

    expect(snapshot.pointer).toEqual({ model: { x: 150, y: 150 }, viewport: { x: 85, y: 92 }, region: 'head', ageMs: 40 })
    expect(snapshot.hostCursor).toEqual({ viewport: { x: 205, y: 107 } })
    expect(overlay.hovered).toBe('head')
    expect(overlay.pointer).toEqual({ x: 85, y: 92 })

    const outside = buildLive2DTouchDebug(input({ pointer: { x: 900, y: 50, atMs: 1000 }, hostCursorGlobal: null }))
    expect(outside.snapshot.pointer?.region).toBeNull()
    expect(outside.snapshot.hostCursor).toBeNull()
  })

  it('reports absent regions as null instead of inventing boxes', () => {
    const { snapshot } = buildLive2DTouchDebug(input({ touch: undefined, cursorUnit: undefined, eyeAnchor: undefined, source: null, pointer: undefined }))

    expect(snapshot.model).toMatchObject({ touch: null, zone: null, exitZone: null, cursorUnit: null, eyeAnchor: null })
    expect(snapshot.viewport.touch).toBeNull()
    expect(snapshot.pointer).toBeNull()
    expect(snapshot.source).toBeNull()
  })

  it('produces a snapshot that survives JSON, as the clipboard and the channel need', () => {
    const gestures = new Live2DTouchGestures()
    gestures.moved({ timeMs: 900, x: 150, y: 150, region: 'head', scale: 200 })
    gestures.moved({ timeMs: 950, x: 170, y: 150, region: 'head', scale: 200 })
    const { snapshot, overlay } = buildLive2DTouchDebug(input({ gesture: gestures.inspect(1000) }))

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    expect(snapshot.thresholds).toEqual(live2DPetThresholds)
    expect(snapshot.transforms).toEqual({
      internalModelLocal: [0.5, 0, 0, 0.5, 0, 0],
      modelWorld: [2, 0, 0, 2, 10, 20],
      canvasClient: { left: 5, top: 7, width: 400, height: 300 },
      canvasBacking: { width: 800, height: 600 },
    })
    expect(overlay.trail).toEqual([{ x: 85, y: 92, inHead: true }, { x: 95, y: 92, inHead: true }])
  })
})
