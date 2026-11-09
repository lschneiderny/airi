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
