import type { KwinWindow } from './pointer-kwin'

import { describe, expect, it } from 'vitest'

import { matchStageWindow, occludingWindows, parseKwinProbe, parseKwinQuery } from './pointer-kwin'

function kwinWindow(overrides: Partial<KwinWindow> = {}): KwinWindow {
  return {
    pid: 4242,
    caption: 'AIRI',
    resourceClass: 'electron',
    active: true,
    minimized: false,
    stack: 3,
    frame: { x: 560, y: 240, width: 800, height: 600 },
    client: { x: 560, y: 240, width: 800, height: 600 },
    ...overrides,
  }
}

const page = { width: 800, height: 600 }

describe('kwin pointer helper output', () => {
  it('parses a query report and rejects malformed ones', () => {
    const report = { screen: { x: 0, y: 0, width: 1920, height: 1080 }, cursor: { x: 960, y: 540 }, activePid: 4242, activeName: 'electron', windows: [kwinWindow()] }
    expect(parseKwinQuery(`${JSON.stringify(report)}\n`)).toEqual(report)
    expect(() => parseKwinQuery('garbage')).toThrow()
    expect(() => parseKwinQuery(JSON.stringify({ ...report, windows: [{ pid: 1 }] }))).toThrow()
    expect(() => parseKwinQuery(JSON.stringify({ ...report, extra: true }))).toThrow()
  })

  it('parses probe results with and without the output geometry', () => {
    expect(parseKwinProbe('{"ok":true,"missing":[],"screen":{"x":0,"y":0,"width":1920,"height":1080}}').screen?.width).toBe(1920)
    expect(parseKwinProbe('{"ok":false,"missing":["libei.so.1: not found"]}')).toEqual({ ok: false, missing: ['libei.so.1: not found'] })
  })
})

describe('matchStageWindow', () => {
  it('prefers the app-owned window whose client rectangle has the page size', () => {
    const other = kwinWindow({ pid: 99, caption: 'other' })
    const caption = kwinWindow({ caption: 'captions', client: { x: 0, y: 900, width: 1920, height: 120 } })
    const stage = kwinWindow()
    expect(matchStageWindow([other, caption, stage], [10, 4242], page)).toEqual({ method: 'pid', window: stage })
  })

  it('ignores minimized windows', () => {
    const stage = kwinWindow()
    expect(matchStageWindow([kwinWindow({ minimized: true, client: { x: 1, y: 1, width: 800, height: 600 } }), stage], [4242], page).window).toBe(stage)
  })

  it('falls back to a unique size match only when no window has an app PID', () => {
    const stage = kwinWindow({ pid: 0 })
    expect(matchStageWindow([stage, kwinWindow({ pid: 0, client: { x: 0, y: 0, width: 300, height: 200 } })], [4242], page)).toEqual({ method: 'size', window: stage })
    expect(() => matchStageWindow([kwinWindow({ pid: 0 }), kwinWindow({ pid: 1 })], [4242], page)).toThrow(/pointer-window-ambiguous: 2 windows .*size match/)
    expect(() => matchStageWindow([], [4242], page)).toThrow(/pointer-window-unmatched/)
  })

  it('refuses an app window whose client rectangle is offset from the page, such as by a menu bar', () => {
    const menu = kwinWindow({ client: { x: 560, y: 240, width: 800, height: 630 } })
    expect(() => matchStageWindow([menu, kwinWindow({ pid: 7 })], [4242], page)).toThrow(/pointer-window-unmatched: no window of the app .*menu bar/)
  })

  it('refuses two app windows of the page size', () => {
    expect(() => matchStageWindow([kwinWindow(), kwinWindow({ caption: 'twin' })], [4242], page)).toThrow(/pointer-window-ambiguous/)
  })
})

describe('occludingWindows', () => {
  it('counts the planned steps that windows stacked above the stage cover inside its client rectangle', () => {
    const stage = kwinWindow()
    const inlay = kwinWindow({ caption: 'Inlay', stack: 4, frame: { x: 700, y: 440, width: 520, height: 200 }, client: { x: 700, y: 440, width: 520, height: 200 } })
    const below = kwinWindow({ caption: 'DevTools', stack: 1, frame: { x: 0, y: 0, width: 1920, height: 1080 } })
    const steps = [{ x: 1250, y: 461 }, { x: 900, y: 461 }, { x: 950, y: 461 }, { x: 956, y: 405 }]
    expect(occludingWindows([below, stage, inlay], stage, steps)).toEqual([{ pid: 4242, caption: 'Inlay', frame: inlay.frame, steps: 2 }])
    expect(occludingWindows([stage, { ...inlay, minimized: true }], stage, steps)).toEqual([])
  })
})
