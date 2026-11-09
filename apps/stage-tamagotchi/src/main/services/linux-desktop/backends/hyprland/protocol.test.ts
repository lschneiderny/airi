import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { parseActive, parseCursor, parseEvent, parseOwnWindows } from './protocol'

const fixture = (name: string) => readFile(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')

describe('hyprland protocol', () => {
  it('maps the active JSON reply into the bridge Active shape', async () => {
    expect(parseActive(await fixture('activewindow.json'))).toEqual({
      caption: 'Untrusted >> title, keep as data',
      resourceClass: 'org.kde.konsole',
      desktopFileName: '',
      pid: 42,
      fullScreen: true,
    })
  })

  it('filters clients by own pid and preserves binding captions and geometry', async () => {
    expect(parseOwnWindows(await fixture('clients.json'), [100])).toEqual([
      { id: '0xdef', pid: 100, caption: 'airi-bind-1', x: -10, y: 50, width: 400, height: 500 },
    ])
  })

  it('reads cursor coordinates without rejecting negative positions', async () => {
    expect(parseCursor(await fixture('cursorpos.json'))).toEqual({ x: -120, y: 340 })
  })

  it('splits event framing once so title separators remain data', async () => {
    const lines = (await fixture('events.txt')).trimEnd().split('\n')
    expect(lines.map(parseEvent)).toEqual([
      { event: 'activewindowv2', data: 'abc' },
      { event: 'windowtitlev2', data: 'abc,Untrusted >> title, keep as data' },
      { event: 'fullscreen', data: '1' },
      { event: 'activewindowv2', data: '' },
    ])
  })

  it.each(['', 'activewindowv2', 'activewindowv2>>not-hex', 'fullscreen>>2', 'windowtitlev2>>abc', 'windowtitlev2>>abc,title\nfullscreen>>1', 'dispatch>>exit', `windowtitlev2>>abc,${'x'.repeat(4096)}`])('ignores malformed or unrelated event %#', (line) => {
    expect(parseEvent(line)).toBeNull()
  })

  it.each(['not JSON', '{}', 'null', '[]', '{"pid":-1}', 'x'.repeat(1048577)])('returns null for invalid JSON payloads without throwing', (input) => {
    expect(parseActive(input)).toBeNull()
    expect(parseCursor(input)).toBeNull()
  })

  it('rejects unbounded titles, bad geometry and nonfinite cursor values', async () => {
    const active: Record<string, unknown> = JSON.parse(await fixture('activewindow.json'))
    expect(parseActive(JSON.stringify({ ...active, title: 'x'.repeat(4097) }))).toBeNull()
    expect(parseActive(JSON.stringify({ ...active, fullscreen: 1 }))?.fullScreen).toBe(false)
    expect(parseOwnWindows('[{"address":"0x1","pid":100,"title":"a","at":[0,0],"size":[-1,2]}]', [100])).toBeNull()
    expect(parseCursor('{"x":1e400,"y":0}')).toBeNull()
  })

  it('discards clients that are not in the current own-pid list', async () => {
    expect(parseOwnWindows(await fixture('clients.json'), [])).toEqual([])
    expect(parseOwnWindows('not JSON', [100])).toBeNull()
  })
})
