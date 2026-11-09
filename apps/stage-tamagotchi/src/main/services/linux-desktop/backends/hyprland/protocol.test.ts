import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { parseActive, parseCursor, parseEvent, parseOutputs, parseOwnWindows } from './protocol'

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
      { event: 'monitoradded', data: 'HDMI-A-1' },
      { event: 'monitoraddedv2', data: '1,HDMI-A-1,Vendor Panel (HDMI-A-1)' },
      { event: 'monitorremoved', data: 'HDMI-A-1' },
      { event: 'monitorremovedv2', data: '1,HDMI-A-1,Vendor Panel (HDMI-A-1)' },
    ])
  })

  it.each(['', 'activewindowv2', 'activewindowv2>>not-hex', 'fullscreen>>2', 'windowtitlev2>>abc', 'monitoradded>>', 'monitoraddedv2>>HDMI-A-1', 'monitorremovedv2>>x,HDMI-A-1', 'monitorremoved>>x\nfullscreen>>1', 'windowtitlev2>>abc,title\nfullscreen>>1', 'dispatch>>exit', `windowtitlev2>>abc,${'x'.repeat(4096)}`])('ignores malformed or unrelated event %#', (line) => {
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

  describe('monitors', () => {
    const monitor = async () => (JSON.parse(await fixture('monitors.json')) as Record<string, unknown>[])[0]

    it('reports enabled monitors in logical layout pixels with their scale and skips disabled ones', async () => {
      expect(parseOutputs(await fixture('monitors.json'))).toEqual([
        { name: 'DP-1', x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
        { name: 'HDMI-A-1', x: 1920, y: -100, width: 2560, height: 1440, scale: 1.5 },
      ])
    })

    it('swaps mode dimensions for quarter-turn transforms before dividing by scale', async () => {
      const rotated = { ...(await monitor()), width: 1080, height: 1920, transform: 1, scale: 1 }
      expect(parseOutputs(JSON.stringify([rotated, { ...rotated, name: 'DP-2', transform: 4 }]))).toEqual([
        { name: 'DP-1', x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
        { name: 'DP-2', x: 0, y: 0, width: 1080, height: 1920, scale: 1 },
      ])
    })

    it('accepts an empty monitor list', () => {
      expect(parseOutputs('[]')).toEqual([])
    })

    it.each([
      ['not JSON', () => 'not JSON'],
      ['an object', () => '{}'],
      ['oversized text', () => 'x'.repeat(1048577)],
      ['a missing scale', async () => JSON.stringify([{ ...(await monitor()), scale: undefined }])],
      ['a zero scale', async () => JSON.stringify([{ ...(await monitor()), scale: 0 }])],
      ['a zero width', async () => JSON.stringify([{ ...(await monitor()), width: 0 }])],
      ['a size that rounds to nothing', async () => JSON.stringify([{ ...(await monitor()), width: 1, scale: 4 }])],
      ['a nonfinite coordinate', async () => `[${JSON.stringify(await monitor()).replace('"x":0', '"x":1e400')}]`],
      ['an unknown transform', async () => JSON.stringify([{ ...(await monitor()), transform: 8 }])],
      ['an unbounded name', async () => JSON.stringify([{ ...(await monitor()), name: 'x'.repeat(257) }])],
      ['too many monitors', async () => JSON.stringify(Array.from({ length: 17 }).fill(await monitor()))],
    ])('rejects %s', async (_name, build) => {
      expect(parseOutputs(await build())).toBeNull()
    })
  })
})
