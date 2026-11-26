import type { PresenceReading } from './presence-hides'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PresenceHides } from './presence-hides'

vi.mock('./installed-apps', () => ({
  installedAppName: () => null,
  listInstalledApps: async () => [],
}))

function reading(overrides: Partial<PresenceReading['sample']> & { appKey?: string } = {}): PresenceReading {
  const { appKey = 'org.mozilla.firefox', ...sample } = overrides
  return {
    sample: {
      exePath: '/usr/lib/firefox/firefox',
      exeName: 'firefox',
      title: '',
      pid: 100,
      windowId: '{window-a}',
      ownProcess: false,
      busy: 'accepts',
      sampledAtMs: 0,
      ...sample,
    },
    appNames: ['firefox', 'firefox', appKey],
    appKey,
  }
}

describe('presenceHides', () => {
  let now: number
  let alive: Set<number>
  let hides: PresenceHides

  beforeEach(() => {
    vi.useFakeTimers()
    now = 1_000_000
    alive = new Set([100, 200])
    hides = new PresenceHides({ now: () => now, isAlive: pid => alive.has(pid), labelFor: key => `Label ${key}`, platform: 'linux' })
  })

  afterEach(() => {
    hides.dispose()
    vi.useRealTimers()
  })

  it('offers the last foreign app in front, and nothing while that app is hidden', () => {
    expect(hides.state().front).toBeNull()

    hides.observe(reading(), false, [])
    expect(hides.state().front).toEqual({ label: 'Label org.mozilla.firefox', appKey: 'org.mozilla.firefox', canHideWindow: true })

    // AIRI's own windows never replace the app the user came from.
    hides.observe(reading({ ownProcess: true, appKey: 'airi' }), false, [])
    expect(hides.state().front?.appKey).toBe('org.mozilla.firefox')

    // Block always in Settings: the next read is AIRI's own window, and it carries the longer block list.
    hides.observe(reading({ ownProcess: true, appKey: 'airi' }), false, ['org.mozilla.firefox'])
    expect(hides.state().front).toBeNull()
    hides.observe(reading(), false, [])

    // A blocked app or a private window must not reach a renderer under its name.
    hides.observe(reading({ appKey: 'bitwarden' }), true, [])
    expect(hides.state().front).toBeNull()

    hides.observe(reading({ windowId: null }), false, [])
    expect(hides.state().front?.canHideWindow).toBe(false)
  })

  it('hides one window until its app quits, and leaves the app\'s other windows visible', () => {
    hides.observe(reading(), false, [])
    const state = hides.add('window', 3_600_000)

    expect(state.hides).toEqual([{ id: '1', scope: 'window', label: 'Label org.mozilla.firefox', untilMs: null }])
    expect(state.front).toBeNull()
    expect(hides.isHidden(reading())).toBe(true)
    expect(hides.isHidden(reading({ windowId: '{window-b}' }))).toBe(false)

    alive.delete(100)
    expect(hides.state().hides).toEqual([])
    expect(hides.isHidden(reading())).toBe(false)
  })

  it('offers no window hide when the host cannot tell windows apart', () => {
    hides.observe(reading({ windowId: null }), false, [])

    expect(hides.add('window', null).hides).toEqual([])
  })

  it('hides every window of an app until its time ends', () => {
    const changes = vi.fn()
    hides.onChange(changes)
    hides.observe(reading(), false, [])
    hides.add('app', 3_600_000)

    expect(hides.isHidden(reading({ windowId: '{window-b}', pid: 200 }))).toBe(true)
    expect(hides.isHidden(reading({ appKey: 'org.kde.konsole' }))).toBe(false)

    changes.mockClear()
    now += 3_600_000
    vi.advanceTimersByTime(3_600_000)
    expect(changes).toHaveBeenCalledExactlyOnceWith({ hides: [], front: null }, true)
    expect(hides.isHidden(reading())).toBe(false)
  })

  it('pauses everything but AIRI, and shows it again when the pause is removed', () => {
    hides.add('all', 60_000)
    // A second pause restarts the pause, so ending it shows everything again.
    const state = hides.add('all', null)

    expect(state.hides).toEqual([{ id: '2', scope: 'all', label: null, untilMs: null }])
    expect(hides.isHidden(reading({ appKey: 'org.kde.konsole' }))).toBe(true)
    expect(hides.isHidden(reading({ ownProcess: true }))).toBe(false)

    expect(hides.remove('2').hides).toEqual([])
    expect(hides.isHidden(reading())).toBe(false)
  })

  it('tells listeners whether the hides changed or only the front app did', () => {
    const changes = vi.fn()
    hides.onChange(changes)

    hides.observe(reading(), false, [])
    hides.observe(reading(), false, [])
    expect(changes).toHaveBeenCalledOnce()
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ hides: [] }), false)

    hides.add('app', null)
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ front: null }), true)
  })
})
