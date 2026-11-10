import type { HostCapabilities } from '@proj-airi/stage-shared/host-capabilities'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { describe, expect, it, vi } from 'vitest'

import { createPointerSampleReporter, shouldReportPointerSamples } from './pointer-samples'

function linux(cursor: HostCapabilities['signals']['cursorScreenPoint'], backend: HostCapabilities['linuxDesktopBackend'] = 'kwin', host: HostCapabilities['host'] = 'linux-wayland'): HostCapabilities {
  const caps = capabilitiesForHost(host)
  return { ...caps, linuxDesktopBackend: backend, signals: { ...caps.signals, cursorScreenPoint: cursor } }
}

function move(target: EventTarget, clientX: number, clientY: number) {
  target.dispatchEvent(Object.assign(new Event('pointermove'), { clientX, clientY }))
}

describe('shouldReportPointerSamples', () => {
  it.each([
    ['verifying on a Linux backend', linux({ kind: 'unavailable', reason: 'linux-cursor-verifying' }), true],
    ['live on a Linux backend', linux({ kind: 'live' }), true],
    ['live on XWayland', linux({ kind: 'live' }, 'hyprland', 'linux-xwayland'), true],
    ['starting', linux({ kind: 'unavailable', reason: 'linux-bridge-starting' }), false],
    ['unreported by sway', linux({ kind: 'unavailable', reason: 'sway-cursor-unreported' }, 'sway'), false],
    ['live without a Linux backend', linux({ kind: 'live' }, null, 'linux-x11'), false],
    ['live on Windows', capabilitiesForHost('windows'), false],
    ['before any snapshot', null, false],
  ] as const)('is %s: %s', (_name, snapshot, expected) => {
    expect(shouldReportPointerSamples(snapshot)).toBe(expected)
  })
})

describe('createPointerSampleReporter', () => {
  it('discards the first XWayland move on each window entry before throttling fresh samples', () => {
    const target = new EventTarget()
    const report = vi.fn()
    let now = 0
    const stop = createPointerSampleReporter({
      target,
      report,
      now: () => now,
      wallClock: () => now,
      snapshot: () => linux({ kind: 'live' }, 'kwin', 'linux-xwayland'),
    })
    // Todo 32 cross-1, cross-2 and cross-2-back: entry moves replay cached positions.
    for (const [at, x, y, entry] of [
      [1000, 960, 540, true],
      [1300, 564, 690, false],
      [40097, 564, 690, true],
      [42065, 711, 700, false],
      [42115, 706, 699, false],
      [42165, 701, 699, false],
      [42215, 696, 698, false],
      [42265, 691, 698, false],
      [42315, 685, 697, false],
      [49903, 685, 697, true],
      [49953, 900, 500, false],
    ] as const) {
      now = at
      if (entry)
        target.dispatchEvent(Object.assign(new Event('pointerover'), { relatedTarget: null }))
      move(target, x, y)
    }
    stop()
    expect(report.mock.calls.map(([sample]) => sample)).toEqual([
      { clientX: 564, clientY: 690, atMs: 1300 },
      { clientX: 711, clientY: 700, atMs: 42065 },
      { clientX: 685, clientY: 697, atMs: 42315 },
      { clientX: 900, clientY: 500, atMs: 49953 },
    ])
  })

  it.each(['linux-wayland', 'linux-x11'] as const)('keeps the first entry sample on %s', (host) => {
    const target = new EventTarget()
    const report = vi.fn()
    const stop = createPointerSampleReporter({
      target,
      report,
      now: () => 1000,
      wallClock: () => 1000,
      snapshot: () => linux({ kind: 'live' }, 'kwin', host),
    })
    target.dispatchEvent(Object.assign(new Event('pointerover'), { relatedTarget: null }))
    move(target, 3, 4)
    stop()
    expect(report.mock.calls).toEqual([[{ clientX: 3, clientY: 4, atMs: 1000 }]])
  })

  it('keeps sustained offset samples after an XWayland entry and ignores child transitions', () => {
    const target = new EventTarget()
    const report = vi.fn()
    let now = 1000
    const stop = createPointerSampleReporter({
      target,
      report,
      now: () => now,
      wallClock: () => now,
      snapshot: () => linux({ kind: 'live' }, 'kwin', 'linux-xwayland'),
    })
    target.dispatchEvent(Object.assign(new Event('pointerover'), { relatedTarget: null }))
    move(target, 960, 540)
    now += 50
    move(target, 3, 4)
    now += 300
    target.dispatchEvent(Object.assign(new Event('pointerover'), { relatedTarget: target }))
    move(target, 4, 5)
    stop()
    expect(report.mock.calls).toEqual([
      [{ clientX: 3, clientY: 4, atMs: 1050 }],
      [{ clientX: 4, clientY: 5, atMs: 1350 }],
    ])
  })

  it('sends at most one sample per 250 ms, only while samples are wanted', () => {
    const target = new EventTarget()
    const report = vi.fn()
    let now = 1000
    let snapshot: HostCapabilities | null = null
    const stop = createPointerSampleReporter({ target, report, now: () => now, wallClock: () => 5000 + now, snapshot: () => snapshot })

    move(target, 1, 1)
    snapshot = linux({ kind: 'unavailable', reason: 'linux-cursor-verifying' })
    move(target, 10, 20)
    now += 249
    move(target, 11, 21)
    now += 1
    move(target, 12, 22)
    expect(report.mock.calls).toEqual([
      [{ clientX: 10, clientY: 20, atMs: 6000 }],
      [{ clientX: 12, clientY: 22, atMs: 6250 }],
    ])

    snapshot = capabilitiesForHost('windows')
    now += 1000
    move(target, 13, 23)
    stop()
    snapshot = linux({ kind: 'live' })
    now += 1000
    move(target, 14, 24)
    expect(report).toHaveBeenCalledTimes(2)
  })
})
