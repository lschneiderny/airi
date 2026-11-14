import type { NaturalReviewState } from '@proj-airi/motion-driver-natural/review'

import { describe, expect, it } from 'vitest'

import { NaturalReviewLog } from './review'

function state(time: number, change: { head?: Partial<NaturalReviewState['head']>, eyes?: Partial<NaturalReviewState['eyes']>, act?: NaturalReviewState['act'], owner?: NaturalReviewState['owner'] } = {}): NaturalReviewState {
  return {
    time,
    mode: 'idle',
    head: { seq: 1, moving: false, size: 0.1, withGlance: false, ...change.head },
    eyes: { seq: 1, target: 'camera', ...change.eyes },
    act: change.act ?? null,
    errand: null,
    owner: change.owner ?? null,
  }
}

describe('natural review log', () => {
  it('records each change once, with the size and cause of a head shift', () => {
    const log = new NaturalReviewLog()
    log.sample(state(0))
    log.sample(state(0.5))
    log.sample(state(1, { head: { seq: 2, moving: true, size: 0.25 } }))
    log.sample(state(1.2, { head: { seq: 2, moving: true, size: 0.25 }, eyes: { seq: 2, target: 'desk' } }))
    log.sample(state(2, { head: { seq: 3, moving: true, withGlance: true }, eyes: { seq: 2, target: 'desk' }, act: 'yawn' }))
    log.sample(state(3, { head: { seq: 3 }, eyes: { seq: 2, target: 'desk' } }))
    expect(log.recent()).toEqual([
      { at: 1, text: 'head shift 7.5 deg alone' },
      { at: 1.2, text: 'eyes to desk' },
      { at: 2, text: 'act yawn started' },
      { at: 2, text: 'head shift 3.0 deg with a glance' },
      { at: 3, text: 'act yawn ended' },
    ])
  })

  it('forgets changes older than 10 s and everything from a controller that restarted', () => {
    const log = new NaturalReviewLog()
    log.sample(state(0))
    log.sample(state(1, { head: { seq: 2 } }))
    log.sample(state(8, { head: { seq: 3 } }))
    log.sample(state(11.5, { head: { seq: 3 } }))
    expect(log.recent().map(entry => entry.at)).toEqual([8])
    log.sample(state(0.2, { head: { seq: 1 } }))
    expect(log.recent()).toEqual([])
  })

  it('treats a shift muted by its gain as a held head', () => {
    const log = new NaturalReviewLog()
    log.sample(state(0))
    log.sample(state(1, { head: { seq: 2, moving: true, size: 0 } }))
    expect(log.recent()).toEqual([])
    expect(log.caption()[0]).toEqual({ label: 'head', text: 'holding 1.0 s' })
  })

  it('captions a held head with how long it has rested, and a moving one with its shift', () => {
    const log = new NaturalReviewLog()
    expect(log.caption()).toEqual([])
    log.sample(state(0, { head: { moving: true } }))
    log.sample(state(0.4, { head: { moving: true } }))
    expect(log.caption()[0]).toEqual({ label: 'head', text: 'shift 3.0 deg alone' })
    log.sample(state(0.5))
    log.sample(state(2, { act: 'peer', owner: 'cursor' }))
    expect(log.caption()).toEqual([
      { label: 'head', text: 'holding 1.5 s' },
      { label: 'eyes', text: 'camera' },
      { label: 'act', text: 'peer' },
      { label: 'mode', text: 'idle, cursor' },
    ])
  })
})
