import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { capabilitiesForHost, HostReasons } from '../host-capabilities'
import { useHostCapabilitiesStore } from './host-capabilities'

describe('useHostCapabilitiesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reports no snapshot and no signal status before a host writes one', () => {
    const store = useHostCapabilitiesStore()

    expect(store.snapshot).toBeNull()
    expect(store.status('cursorScreenPoint')).toBeNull()
  })

  it('holds the written snapshot and answers per-signal status', () => {
    const store = useHostCapabilitiesStore()
    const caps = capabilitiesForHost('linux-wayland')

    store.set(caps)

    expect(store.snapshot).toBe(caps)
    expect(store.status('cursorScreenPoint')).toEqual({ kind: 'unavailable', reason: HostReasons.WaylandCursorUnreported })
    expect(store.status('alwaysOnTop')).toEqual({ kind: 'unavailable', reason: HostReasons.WaylandNoZOrder })
  })

  it('replaces the snapshot on a later write', () => {
    const store = useHostCapabilitiesStore()

    store.set(capabilitiesForHost('linux-wayland'))
    store.set(capabilitiesForHost('windows'))

    expect(store.status('cursorScreenPoint')).toEqual({ kind: 'live' })
  })

  it('clears the snapshot on reset', () => {
    const store = useHostCapabilitiesStore()
    store.set(capabilitiesForHost('windows'))

    store.reset()

    expect(store.snapshot).toBeNull()
    expect(store.status('cursorScreenPoint')).toBeNull()
  })
})
