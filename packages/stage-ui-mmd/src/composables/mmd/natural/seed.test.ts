import { describe, expect, it } from 'vitest'

import { fnv1a32 } from './seed'

describe('mmd model seed', () => {
  it('hashes UTF-16 code units rather than encoded UTF-8 bytes', () => {
    expect(fnv1a32('')).toBe(0x811C9DC5)
    expect(fnv1a32('hello')).toBe(0x4F9F2CAB)
    // Independently calculated: offset XOR 0xD83D, multiply; XOR 0xDE00, multiply.
    expect(fnv1a32('😀')).toBe(0xCB31C4B8)
    expect(fnv1a32('\uD83D')).not.toBe(fnv1a32('😀'))
  })
})
