import { describe, expect, it } from 'vitest'

import { MMDWalkPreview, WALK_PREVIEW_MS, WALK_PREVIEW_WAIT_MS } from './walk-preview'

const card = { stride: 0.2 }
const preview = { sway: 0.8 }

describe('mMDWalkPreview', () => {
  it('starts its time when she walks to the preview goal, not on a walk already under way', () => {
    const walk = new MMDWalkPreview()
    walk.start(preview)
    // She is still on another walk when the preview arrives; then speech holds the preview goal for 40 s.
    expect(walk.update(0, null, true, card)).toBe(preview)
    for (let now = 1_000; now <= 41_000; now += 1_000)
      expect(walk.update(now, 'held', false, card)).toBe(preview)
    expect(walk.update(42_000, 'issued', true, card)).toBe(preview)
    expect(walk.update(42_000 + WALK_PREVIEW_MS - 1, 'issued', true, card)).toBe(preview)
    expect(walk.update(42_000 + WALK_PREVIEW_MS, 'issued', true, card)).toBe(card)
  })

  it('keeps waiting across a frame gap longer than the wait while the director holds the goal', () => {
    const walk = new MMDWalkPreview()
    walk.start(preview)
    walk.update(0, 'held', false, card)
    expect(walk.update(WALK_PREVIEW_WAIT_MS + 15_000, 'held', false, card)).toBe(preview)
  })

  it('runs out when the director never takes the goal up', () => {
    const walk = new MMDWalkPreview()
    walk.start(preview)
    walk.update(0, null, false, card)
    expect(walk.update(WALK_PREVIEW_WAIT_MS, null, false, card)).toBe(card)
    // A later debug walk is not the preview's.
    expect(walk.update(WALK_PREVIEW_WAIT_MS + 1_000, 'issued', true, card)).toBe(card)
  })
})
