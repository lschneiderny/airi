import { describe, expect, it } from 'vitest'

import { planStageDrag, playStageDrag } from './stage-pointer'

describe('planStageDrag', () => {
  it('hovers and presses at the start, moves with the button held, and releases at the end in window coordinates', () => {
    const steps = planStageDrag({ x: 110, y: 220 }, { x: 150, y: 220 }, { origin: { x: 10, y: 20 }, moves: 2, stepMs: 30 })

    expect(steps.map(step => step.mouse)).toEqual([
      { type: 'mouseMoved', x: 100, y: 200 },
      { type: 'mousePressed', x: 100, y: 200, button: 'left', buttons: 1, clickCount: 1 },
      { type: 'mouseMoved', x: 120, y: 200, button: 'left', buttons: 1 },
      { type: 'mouseMoved', x: 140, y: 200, button: 'left', buttons: 1 },
      { type: 'mouseReleased', x: 140, y: 200, button: 'left', buttons: 0, clickCount: 1 },
    ])
    expect(steps.map(step => step.atMs)).toEqual([0, 0, 30, 60, 60])
    expect(steps.map(step => step.screen.x)).toEqual([110, 110, 130, 150, 150])
  })

  it('rejects a drag without moves', () => {
    expect(() => planStageDrag({ x: 0, y: 0 }, { x: 1, y: 0 }, { origin: { x: 0, y: 0 }, moves: 0 })).toThrow('at least one move')
  })
})

describe('playStageDrag', () => {
  it('warps the OS cursor before each CDP event', async () => {
    const log: string[] = []
    const steps = planStageDrag({ x: 0, y: 0 }, { x: 20, y: 0 }, { origin: { x: 0, y: 0 }, moves: 1, stepMs: 0 })

    await playStageDrag({ send: async (_method, params) => log.push(`cdp:${String(params?.type)}`) }, steps, async point => log.push(`warp:${point.x}`))

    expect(log).toEqual(['warp:0', 'cdp:mouseMoved', 'warp:0', 'cdp:mousePressed', 'warp:20', 'cdp:mouseMoved', 'warp:20', 'cdp:mouseReleased'])
  })
})
