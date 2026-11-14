import { describe, expect, it } from 'vitest'

import { FRAME_BINS_V1, STAGE_BINS_V1 } from './bins'

// Stored records name these edges by id, so a changed edge must fail here and force a new id.
describe('persisted bin sets', () => {
  it('keeps the frame-v1 edges', () => {
    expect(FRAME_BINS_V1.id).toBe('frame-v1')
    expect(FRAME_BINS_V1.edges).toEqual([4, 6, 7.5, 9, 10.5, 12.5, 15, 18, 21, 25, 30, 36, 42, 58, 75, 100, 150, 250, 500, 1000, 2000])
  })

  it('keeps the stage-v1 edges', () => {
    expect(STAGE_BINS_V1.id).toBe('stage-v1')
    expect(STAGE_BINS_V1.edges).toEqual([0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 25, 50])
  })
})
