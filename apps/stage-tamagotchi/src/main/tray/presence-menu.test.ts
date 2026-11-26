import type { PresenceHidesState } from '../../shared/eventa'

import { describe, expect, it, vi } from 'vitest'

import { PRESENCE_HIDE_HOUR_MS, presenceMenuItems } from './presence-menu'

function menu(state: PresenceHidesState) {
  const handlers = { add: vi.fn(), remove: vi.fn(), openSettings: vi.fn() }
  const t = (key: string, named?: Record<string, unknown>) => named ? `${key.split('.').pop()}:${String(named.app)}` : key.split('.').pop()!
  return { items: presenceMenuItems({ state, t, ...handlers }), ...handlers }
}

describe('presenceMenuItems', () => {
  it('offers to hide the front app, and only the whole app when the host cannot tell windows apart', () => {
    const { items, add } = menu({ hides: [], front: { label: 'Firefox', appKey: 'firefox', canHideWindow: false } })

    expect(items.map(item => item.label ?? item.type)).toEqual(['Firefox', 'this_window', 'app_hour', 'app_session', 'separator', 'pause_hour', 'separator', 'settings'])
    expect(items[1]?.enabled).toBe(false)
    items[2]?.click?.({} as never, undefined, {} as never)
    expect(add).toHaveBeenCalledWith('app', PRESENCE_HIDE_HOUR_MS)
  })

  it('offers nothing to hide without a front app, and a way to end each hide', () => {
    const { items, remove, add } = menu({
      hides: [
        { id: '1', scope: 'window', label: 'Firefox', untilMs: null },
        { id: '2', scope: 'all', label: null, untilMs: 1 },
      ],
      front: null,
    })

    expect(items.map(item => item.label ?? item.type)).toEqual(['no_app', 'separator', 'pause_hour', 'separator', 'show_window:Firefox', 'end_pause', 'separator', 'settings'])
    items[2]?.click?.({} as never, undefined, {} as never)
    expect(add).toHaveBeenCalledWith('all', PRESENCE_HIDE_HOUR_MS)
    items[5]?.click?.({} as never, undefined, {} as never)
    expect(remove).toHaveBeenCalledWith('2')
  })
})
