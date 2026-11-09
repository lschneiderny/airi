import type { ShortcutBinding } from '@proj-airi/stage-shared/global-shortcut'

import { once } from 'node:events'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PortalShortcutsDriver } from './global-shortcuts-portal'
import { portal, sessionInterface } from './portal-request'
import { FakePortal } from './portal.test-helper'

const binding: ShortcutBinding = {
  id: 'voice-push-to-talk',
  accelerator: { modifiers: ['ctrl', 'shift'], key: 'Space' },
  scope: 'global',
  receiveKeyUps: true,
  description: 'Push to Talk',
}

describe('globalShortcuts portal on a private daemon', () => {
  let bus: FakePortal
  let driver: PortalShortcutsDriver
  let states: string[]
  let triggers: [string, string][]
  let errors: unknown[]
  let events: EventTarget

  beforeEach(async () => {
    bus = new FakePortal()
    await bus.start()
    await bus.install()
    states = []
    triggers = []
    errors = []
    events = new EventTarget()
    driver = new PortalShortcutsDriver({
      sessionBus: bus.client,
      flatpak: false,
      onState: (state) => {
        states.push(state)
        events.dispatchEvent(new Event('state'))
      },
      onTriggered: (id, phase) => {
        triggers.push([id, phase])
        events.dispatchEvent(new Event('key'))
      },
      onError: error => errors.push(error),
      requestTimeoutMs: 200,
    })
  })

  afterEach(async () => {
    await driver.stop()
    await bus.close()
  })

  it('registers before creating and waits for an immediate Response before reporting readiness', async () => {
    expect(await driver.start()).toBe(true)
    expect(await driver.start()).toBe(true)
    expect(states).toEqual(['session'])
    expect(bus.registerCount).toBe(1)
    expect(bus.createCount).toBe(1)
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: true }])
    expect(states).toEqual(['session', 'bound'])
    expect(bus.requested).toEqual([[binding.id, { description: 'Push to Talk', preferred_trigger: 'CTRL+SHIFT+space' }]])
    expect(errors).toEqual([])
  })

  it.each([1, 2])('maps response %s to Denied and recreates before rebinding', async (code) => {
    bus.code = code
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: false, reason: 'denied' }])
    expect(states).toEqual(['session'])
    bus.code = 0
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: true }])
    expect(bus.createCount).toBe(2)
    expect(bus.registerCount).toBe(1)
    expect(bus.closedSessions).toHaveLength(1)
    expect(states.at(-1)).toBe('bound')
  })

  it('delivers down and up only for a bound id and the current session', async () => {
    await driver.bind([binding])
    bus.client.emitSignal('/org/freedesktop/portal/desktop', 'org.freedesktop.portal.GlobalShortcuts', 'Activated', 'osta{sv}', [bus.session, binding.id, 1n, {}])
    bus.key('Activated', binding.id, '/other')
    bus.key('Activated', 'unknown')
    bus.key('Activated')
    bus.key('Deactivated')
    await bus.drain()
    expect(triggers).toEqual([[binding.id, 'down'], [binding.id, 'up']])
  })

  it('updates trigger text and releases a held key when ShortcutsChanged removes it', async () => {
    await driver.bind([binding])
    bus.changed(bus.bound('Meta+Space'))
    await bus.drain()
    expect(driver.list().map(entry => entry.triggerDescription)).toEqual(['Meta+Space'])
    bus.key('Activated')
    bus.changed([])
    await bus.drain()
    expect(states.at(-1)).toBe('session')
    expect(driver.list()).toEqual([])
    expect(triggers).toEqual([[binding.id, 'down'], [binding.id, 'up']])
  })

  it('does not claim key-up readiness for a press-only or omitted binding', async () => {
    expect(await driver.bind([{ ...binding, receiveKeyUps: false }])).toEqual([{ id: binding.id, ok: true }])
    expect(states.at(-1)).toBe('session')
    bus.acceptedIds = []
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: false, reason: 'denied' }])
    expect(states.at(-1)).toBe('session')
  })

  it('unbinds by closing the old session and recreates an empty session', async () => {
    await driver.bind([binding])
    const oldSession = bus.session
    await driver.unregisterById(binding.id)
    expect(bus.closedSessions).toContain(oldSession)
    expect(driver.list()).toEqual([])
    expect(states.at(-1)).toBe('session')
    bus.key('Activated', binding.id, oldSession)
    await bus.drain()
    expect(triggers).toEqual([])
  })

  it('recreates after Closed without registering the same connection again', async () => {
    await driver.bind([binding])
    bus.service.emitSignal(bus.session, sessionInterface, 'Closed', 'a{sv}', [{}])
    await bus.drain()
    expect(states.at(-1)).toBe('absent')
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: true }])
    expect(bus.registerCount).toBe(1)
    expect(bus.createCount).toBe(2)
  })

  it('drops readiness on owner loss and re-registers after the portal returns', async () => {
    await driver.bind([binding])
    const changed = once(events, 'state', { signal: AbortSignal.timeout(2000) })
    await bus.service.call({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'ReleaseName', signature: 's', body: [portal] })
    await changed
    expect(states.at(-1)).toBe('absent')
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: false, reason: 'unsupported' }])
    bus.registered = false
    await bus.name(portal)
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: true }])
    expect(bus.registerCount).toBe(2)
  })

  it.each(['session', 'shortcuts'] as const)('rejects malformed %s responses without claiming bound', async (malformed) => {
    bus.malformed = malformed
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: false, reason: malformed === 'session' ? 'unsupported' : 'denied' }])
    expect(states).not.toContain('bound')
    expect(errors).toHaveLength(1)
  })

  it('rejects unmappable accelerators without opening a portal interaction', async () => {
    expect(await driver.bind([{ ...binding, accelerator: { modifiers: [], key: 'Bogus' } }])).toEqual([{ id: binding.id, ok: false, reason: 'invalid' }])
    expect(bus.createCount).toBe(0)
  })

  it.each(['CreateSession', 'BindShortcuts'] as const)('bounds a missing %s Response and closes its Request', async (member) => {
    bus.hold = member
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: false, reason: member === 'CreateSession' ? 'unsupported' : 'denied' }])
    expect(bus.closedRequests).toHaveLength(1)
    expect(states).not.toContain('bound')
    bus.hold = undefined
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: true }])
  })

  it('cancels in-flight bind on stop and ignores subsequent portal signals', async () => {
    bus.hold = 'BindShortcuts'
    const requested = once(bus.events, 'BindShortcuts', { signal: AbortSignal.timeout(2000) })
    const pending = driver.bind([binding])
    await requested
    await driver.stop()
    expect(await pending).toEqual([{ id: binding.id, ok: false, reason: 'unsupported' }])
    const stoppedStates = [...states]
    bus.key('Activated')
    bus.changed()
    await bus.drain()
    expect(states).toEqual(stoppedStates)
    expect(triggers).toEqual([])
    expect(bus.closedRequests).toHaveLength(1)
    bus.hold = undefined
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: true }])
  })

  it('skips Registry entirely inside Flatpak', async () => {
    await driver.stop()
    bus.flatpak = true
    driver = new PortalShortcutsDriver({ sessionBus: bus.client, flatpak: true, onState: state => states.push(state), onTriggered: () => {}, onError: error => errors.push(error) })
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: true }])
    expect(bus.registerCount).toBe(0)
  })

  it.each(['closed', 'owner-loss'] as const)('cancels a pending request on %s without resurrecting readiness', async (kind) => {
    bus.hold = 'BindShortcuts'
    const requested = once(bus.events, 'BindShortcuts', { signal: AbortSignal.timeout(2000) })
    const pending = driver.bind([binding])
    await requested
    if (kind === 'closed')
      bus.service.emitSignal(bus.session, sessionInterface, 'Closed', 'a{sv}', [{}])
    else
      await bus.service.call({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'ReleaseName', signature: 's', body: [portal] })
    expect(await pending).toEqual([{ id: binding.id, ok: false, reason: 'unsupported' }])
    expect(states.at(-1)).toBe('absent')
    expect(bus.closedRequests).toHaveLength(1)
  })

  it('rejects an unknown response code and closes its provisional session', async () => {
    bus.responseCode = 99
    expect(await driver.start()).toBe(false)
    expect(bus.closedSessions).toHaveLength(1)
    expect(states).toEqual([])
  })

  it('serializes unregister behind an already queued bind', async () => {
    const pending = driver.bind([binding, { ...binding, id: 'second' }])
    const removed = driver.unregisterById(binding.id)
    await pending
    expect(await removed).toEqual([{ id: 'second', ok: true }])
    expect(driver.list().map(entry => entry.binding.id)).toEqual(['second'])
  })

  it('never reports bound from ShortcutsChanged before a successful bind Response', async () => {
    bus.hold = 'BindShortcuts'
    const requested = once(bus.events, 'BindShortcuts', { signal: AbortSignal.timeout(2000) })
    const pending = driver.bind([binding])
    await requested
    bus.changed()
    await bus.drain()
    expect(states).toEqual(['session'])
    expect(driver.list()).toEqual([])
    await driver.stop()
    await pending
  })

  it('preserves shortcut removal arriving before the bind continuation', async () => {
    bus.changeBeforeResponse = []
    expect(await driver.bind([binding])).toEqual([{ id: binding.id, ok: false, reason: 'denied' }])
    expect(states).toEqual(['session'])
    expect(driver.list()).toEqual([])
  })
})
