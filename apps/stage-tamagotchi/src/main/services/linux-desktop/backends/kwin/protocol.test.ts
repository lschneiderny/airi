import { describe, expect, it } from 'vitest'

import { parseActive, parseCursor, parseHello, parseOwnPids, parseOwnWindows } from './protocol'

const active = { caption: 'untrusted window title', resourceClass: 'konsole', desktopFileName: 'org.kde.konsole', pid: 42, fullScreen: false }
const ownWindow = { id: '{window-1}', pid: 42, x: -100, y: 50, width: 800, height: 600, keepAbove: true, outputScale: 1.25 }

describe('kwin protocol', () => {
  it.each(['plasma6', 'plasma5', 'unsupported'])('accepts the %s Hello fixture', (api) => {
    expect(parseHello(JSON.stringify({ api }))).toEqual({ api })
  })

  it('accepts active windows and the no-active-window payload', () => {
    expect(parseActive(JSON.stringify(active))).toEqual(active)
    expect(parseActive('null')).toBeNull()
    expect(parseActive(JSON.stringify({ ...active, caption: 'x'.repeat(4096) }))?.caption).toHaveLength(4096)
  })

  it('accepts bounded own windows, cursor coordinates and the OwnPids reply', () => {
    expect(parseOwnWindows(JSON.stringify([ownWindow]))).toEqual([ownWindow])
    expect(parseOwnWindows(JSON.stringify(Array.from({ length: 32 }).fill(ownWindow)))).toHaveLength(32)
    expect(parseOwnWindows('[]')).toEqual([])
    expect(parseCursor('{"x":-1.5,"y":0}')).toEqual({ x: -1.5, y: 0 })
    expect(parseOwnPids('[42,43]')).toEqual([42, 43])
  })

  it.each([
    ['Hello', parseHello],
    ['Active', parseActive],
    ['OwnWindows', parseOwnWindows],
    ['Cursor', parseCursor],
    ['OwnPids', parseOwnPids],
  ] as const)('rejects malformed and oversized %s JSON without reflecting input', (_method, parse) => {
    for (const payload of ['{secret-caption', ' '.repeat(65537), undefined, 123]) {
      expect(() => parse(payload)).toThrow('Invalid KWin payload')
      expect(() => parse(payload)).not.toThrow('secret-caption')
    }
  })

  it.each([
    () => parseHello('{"api":"plasma7"}'),
    () => parseActive(JSON.stringify({ ...active, caption: 'x'.repeat(4097) })),
    () => parseActive(JSON.stringify({ ...active, pid: -1 })),
    () => parseActive(JSON.stringify({ ...active, fullScreen: 'false' })),
    () => parseActive(JSON.stringify({ ...active, resourceClass: 'x'.repeat(4097) })),
    () => parseOwnWindows(JSON.stringify(Array.from({ length: 33 }).fill(ownWindow))),
    () => parseOwnWindows(JSON.stringify([{ ...ownWindow, width: -1 }])),
    () => parseOwnWindows(JSON.stringify([{ ...ownWindow, outputScale: 0 }])),
    () => parseOwnWindows(JSON.stringify([{ ...ownWindow, id: 1 }])),
    () => parseOwnWindows(JSON.stringify([{ ...ownWindow, caption: 'not part of todo 4' }])),
    () => parseCursor('{"x":1e999,"y":0}'),
    () => parseCursor('{"x":1}'),
    () => parseOwnPids('[0]'),
    () => parseOwnPids('[1.5]'),
    () => parseOwnPids('["42"]'),
  ])('rejects invalid method fields', (parse) => {
    expect(parse).toThrow('Invalid KWin payload')
  })
})
