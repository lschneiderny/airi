import { describe, expect, it } from 'vitest'

import { parseVtubeHotkeys } from './vtube'

describe('parseVtubeHotkeys', () => {
  it.each([null, [], {}, { Hotkeys: null }, { Hotkeys: 'bad' }])('ignores unknown shapes: %j', (input) => {
    expect(parseVtubeHotkeys(input)).toEqual([])
  })

  it('preserves vendor extensions and ignores malformed individual entries', () => {
    const valid = { Action: 'ToggleExpression', File: 'face.exp3.json', Name: 'face' }
    expect(parseVtubeHotkeys({ Hotkeys: [null, {}, { ...valid, Name: 42 }, { ...valid, Extra: true }], Version: 1 })).toEqual([valid])
  })
})
