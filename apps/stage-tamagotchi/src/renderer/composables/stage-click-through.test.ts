import type { StageClickThroughInput, StageClickThroughState } from './stage-click-through'

import { describe, expect, it } from 'vitest'

import { contradictStageCursor, createStageClickThroughState, createStageCursorTrust, createStageHitReadState, observeStageCursor, planStageHitRead, resolveStageClickThrough, stageCursorStaleAfterMs, stageMovingReadIntervalMs, stageRestingReadIntervalMs, trustedStageCursor } from './stage-click-through'

const rect = { x: 100, y: 200, width: 200, height: 560 }
const onHer = { x: 200, y: 400 }
const farAway = { x: 900, y: 100 }

function run(state: StageClickThroughState, input: Partial<StageClickThroughInput> & { nowMs: number }) {
  return resolveStageClickThrough(state, { cursor: onHer, rect, forceCapture: false, forceIgnore: false, ...input })
}

function captured(nowMs = 0): StageClickThroughState {
  return run(createStageClickThroughState(), { nowMs, hit: true }).state
}

describe('resolveStageClickThrough', () => {
  it('lets clicks through outside the padded rect without needing a readback', () => {
    const result = run(captured(), { nowMs: 16, cursor: farAway })
    expect(result.state.ignoring).toBe(true)
    expect(result.changed).toBe(true)

    // 8 DIP of padding still counts as inside, so the decision waits for the readback there.
    const edge = run(captured(), { nowMs: 16, cursor: { x: rect.x - 8, y: 400 } })
    expect(edge.state.ignoring).toBe(false)
    expect(edge.changed).toBe(false)
  })

  it('captures on the first hit inside the rect', () => {
    const result = run(createStageClickThroughState(), { nowMs: 0, hit: true })
    expect(result.state.ignoring).toBe(false)
    expect(result.changed).toBe(true)
  })

  it('stays click-through on misses inside the rect and reports no change', () => {
    let state = createStageClickThroughState()
    for (let frame = 0; frame < 5; frame++) {
      const result = run(state, { nowMs: frame * 16, hit: false })
      expect(result.changed).toBe(false)
      state = result.state
    }
    expect(state.ignoring).toBe(true)
  })

  it('releases only after two consecutive misses', () => {
    const one = run(captured(0), { nowMs: 300, hit: false })
    expect(one.state.ignoring).toBe(false)
    const hitAgain = run(one.state, { nowMs: 316, hit: true })
    const afterHit = run(hitAgain.state, { nowMs: 632, hit: false })
    expect(afterHit.state.ignoring).toBe(false)

    const two = run(afterHit.state, { nowMs: 648, hit: false })
    expect(two.state.ignoring).toBe(true)
    expect(two.changed).toBe(true)
  })

  it('captures at once but debounces the release for 250 ms after the last hit', () => {
    let state = captured(1000)
    state = run(state, { nowMs: 1016, hit: false }).state
    state = run(state, { nowMs: 1032, hit: false }).state
    expect(state.ignoring).toBe(false)

    state = run(state, { nowMs: 1249, hit: false }).state
    expect(state.ignoring).toBe(false)
    const released = run(state, { nowMs: 1250, hit: false })
    expect(released.state.ignoring).toBe(true)

    const recaptured = run(released.state, { nowMs: 1266, hit: true })
    expect(recaptured.state.ignoring).toBe(false)
    expect(recaptured.changed).toBe(true)
  })

  it('keeps the state when no readback ran this frame', () => {
    const state = captured(0)
    const result = run(state, { nowMs: 1000 })
    expect(result.state).toBe(state)
    expect(result.changed).toBe(false)
  })

  it('forces capture anywhere while the controls, a pause or a drag hold the pointer', () => {
    const result = run(createStageClickThroughState(), { nowMs: 0, cursor: farAway, forceCapture: true })
    expect(result.state.ignoring).toBe(false)
    expect(result.changed).toBe(true)
  })

  it('keeps ignoring a hit while click-through is unusable', () => {
    const result = run(createStageClickThroughState(), { nowMs: 0, hit: true, forceIgnore: true })
    expect(result.state.ignoring).toBe(true)
    expect(result.changed).toBe(false)
  })

  it('lets an unusable click-through win over a press, a pause or the controls', () => {
    const result = run(createStageClickThroughState(), { nowMs: 0, cursor: farAway, forceCapture: true, forceIgnore: true })
    expect(result.state.ignoring).toBe(true)
    expect(result.changed).toBe(false)
  })

  it('releases a captured pointer at once when click-through becomes unusable', () => {
    const result = run(captured(0), { nowMs: 16, hit: true, forceIgnore: true })
    expect(result.state.ignoring).toBe(true)
    expect(result.changed).toBe(true)
  })

  it('lets clicks through before the scene publishes a rect', () => {
    const result = run(captured(), { nowMs: 16, rect: null, hit: true })
    expect(result.state.ignoring).toBe(true)
  })
})

describe('planStageHitRead', () => {
  const plan = (state: ReturnType<typeof createStageHitReadState>, nowMs: number, cursor: { x: number, y: number } | null = onHer, forceCapture = false, forceIgnore = false) =>
    planStageHitRead(state, { nowMs, cursor, rect, forceCapture, forceIgnore })

  it('skips the read when the answer is known without one', () => {
    expect(plan(createStageHitReadState(), 0, farAway).read).toBe(false)
    expect(plan(createStageHitReadState(), 0, null).read).toBe(false)
    expect(plan(createStageHitReadState(), 0, onHer, true).read).toBe(false)
    expect(plan(createStageHitReadState(), 0, onHer).read).toBe(true)
  })

  it('skips the read while click-through is unusable', () => {
    const result = plan(createStageHitReadState(), 0, onHer, false, true)
    expect(result.read).toBe(false)
    expect(result.state).toEqual(createStageHitReadState())
  })

  it('reuses the last answer for a still cursor until the resting interval has passed', () => {
    const first = plan(createStageHitReadState(), 1_000)
    expect(plan(first.state, 1_000 + stageRestingReadIntervalMs - 1).read).toBe(false)
    expect(plan(first.state, 1_000 + stageRestingReadIntervalMs).read).toBe(true)
  })

  it('reads a moving cursor at most once per moving interval', () => {
    let state = createStageHitReadState()
    let reads = 0
    for (let frame = 0; frame < 60; frame++) {
      const result = plan(state, frame * 16.7, { x: onHer.x + frame, y: onHer.y })
      state = result.state
      if (result.read)
        reads++
    }
    // At 60 fps a 50 ms interval reads on frames 0, 3, 6, ...: 20 of 60 frames instead of all 60.
    expect(stageMovingReadIntervalMs).toBe(50)
    expect(reads).toBe(20)
  })
})

describe('stage cursor trust', () => {
  function resting(cursor = onHer, sinceMs = 0) {
    return observeStageCursor(createStageCursorTrust(), cursor, sinceMs)
  }

  it('trusts the host cursor that the window has not contradicted', () => {
    expect(trustedStageCursor(resting())).toEqual(onHer)
    expect(trustedStageCursor(createStageCursorTrust())).toBeNull()
  })

  it('keeps trusting a resting cursor that the window agrees with', () => {
    const trust = contradictStageCursor(resting(), { x: onHer.x + 1.5, y: onHer.y - 1 }, 5_000)
    expect(trustedStageCursor(trust)).toEqual(onHer)
  })

  it('keeps trusting a cursor that moved recently, because the host reading lags the window', () => {
    const trust = contradictStageCursor(resting(onHer, 1_000), farAway, 1_000 + stageCursorStaleAfterMs - 1)
    expect(trustedStageCursor(trust)).toEqual(onHer)
  })

  // Gate review of todos 14-16: on X11 the Electron cursor stayed put under a foreign fullscreen window.
  it('withholds a host reading that stopped moving while the window saw the pointer elsewhere', () => {
    const trust = contradictStageCursor(resting(onHer, 1_000), farAway, 1_000 + stageCursorStaleAfterMs)
    expect(trustedStageCursor(trust)).toBeNull()
    // The same stale reading stays withheld frame after frame, so the stage does not capture again.
    expect(trustedStageCursor(observeStageCursor(trust, onHer, 9_000))).toBeNull()
  })

  it('trusts the host cursor again once its reading moves', () => {
    const stale = contradictStageCursor(resting(onHer, 0), farAway, stageCursorStaleAfterMs)
    const moved = observeStageCursor(stale, { x: onHer.x + 3, y: onHer.y }, 9_000)
    expect(trustedStageCursor(moved)).toEqual({ x: onHer.x + 3, y: onHer.y })
  })

  it('lets a withheld cursor release a captured stage', () => {
    const stale = contradictStageCursor(resting(onHer, 0), farAway, stageCursorStaleAfterMs)
    const result = run(captured(0), { nowMs: 1_000, cursor: trustedStageCursor(stale), hit: true })
    expect(result.state.ignoring).toBe(true)
    expect(result.changed).toBe(true)
  })
})
