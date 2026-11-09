import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { parseAtomArray, parseUtf8Name, parseWmClass } from './parsers'

describe('x11 property parsers', () => {
  it.each([
    [Buffer.from('端末'), '端末'],
    [Buffer.from('terminal\0'), 'terminal'],
    [Buffer.alloc(0), ''],
    [Buffer.from([0xC3]), null],
    [Buffer.from([0xFF]), null],
    [Buffer.from('one\0two'), null],
  ])('decodes complete UTF-8 names %#', (data, expected) => {
    expect(parseUtf8Name(data)).toBe(expected)
  })

  it.each([
    [Buffer.from('instance\0konsole\0'), 'konsole'],
    [Buffer.from('\0Konsole\0'), 'Konsole'],
    [Buffer.from('instance\0'), null],
    [Buffer.from('instance\0class'), null],
    [Buffer.from('instance\0class\0extra\0'), null],
    [Buffer.from([0xFF, 0, 0xFF, 0]), '\u00FF'],
    [Buffer.from('696e7374616e636500436166e900', 'hex'), 'Caf\u00E9'],
    [Buffer.from('e9006b6f6e736f6c6500', 'hex'), 'konsole'],
    [Buffer.from([0, 0x80, 0]), '\u0080'],
    [Buffer.alloc(0), null],
  ])('extracts the class from a complete WM_CLASS pair %#', (data, expected) => {
    expect(parseWmClass(data)).toBe(expected)
  })

  it.each([
    [[1, 4294967295], [1, 4294967295]],
    [new BigUint64Array([1n, 4294967295n]), [1, 4294967295]],
    [new Uint32Array([1, 42]), [1, 42]],
    [new BigUint64Array([4294967296n]), null],
    [new Uint8Array([1, 0, 0]), null],
    [[], []],
    [[-1], null],
    [[1.5], null],
    [[4294967296], null],
    [[Number.NaN], null],
    [['1'], null],
    [null, null],
  ])('accepts only arrays of X11 protocol atom IDs %#', (data, expected) => {
    expect(parseAtomArray(data)).toEqual(expected)
  })
})
