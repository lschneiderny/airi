import { describe, expect, it } from 'vitest'

import { parseClipArguments } from './clip'

describe('qa:motion3d clip arguments', () => {
  it('opens a window around an event with default lead-in and follow-through', () => {
    expect(parseClipArguments(['run', '--model', 'm.pmx', '--around', 'gesture-stroke', '--out', 'c.mp4'], '/w').selection).toEqual({ kind: 'around', marker: 'gesture-stroke', before: 2, after: 4, match: 1 })
  })

  it('refuses an output it cannot encode and lead-in options without --around', () => {
    expect(() => parseClipArguments(['run', '--model', 'm.pmx', '--out', 'c.avi'], '/w')).toThrow(/\.mp4/)
    expect(() => parseClipArguments(['run', '--model', 'm.pmx', '--before', '1', '--out', 'c.mp4'], '/w')).toThrow(/--around/)
  })
})
