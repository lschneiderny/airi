import { once } from 'node:events'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { busyHint, BusySource } from './busy'
import { PrivateBus } from './private-bus.test-helper'

describe('busy hint mapping', () => {
  it.each([
    [0, false, null],
    [0, true, 'quiet'],
    [2, true, 'busy'],
    [1, false, 'busy'],
    [undefined, true, 'quiet'],
    [undefined, undefined, null],
    ['2', 'true', null],
    [-1, false, null],
    [Number.NaN, false, null],
    [0.5, false, null],
    [Number.POSITIVE_INFINITY, false, null],
  ])('maps count %s and inhibition %s to %s', (count, inhibited, expected) => {
    expect(busyHint(count, inhibited)).toBe(expected)
  })
})

describe('busy source on a private daemon', () => {
  let bus: PrivateBus
  let source: BusySource
  let events: EventTarget
  let transitions: ('busy' | 'quiet' | null)[]
  const notifications = 'org.freedesktop.Notifications'
  const notificationsPath = '/org/freedesktop/Notifications'
  const game = 'com.feralinteractive.GameMode'
  const gamePath = '/com/feralinteractive/GameMode'

  beforeEach(async () => {
    bus = new PrivateBus()
    await bus.start()
    events = new EventTarget()
    transitions = []
    source = new BusySource({ sessionBus: bus.client, onHint: (hint) => {
      transitions.push(hint)
      events.dispatchEvent(new Event('hint'))
    } })
  })

  afterEach(async () => {
    source?.stop()
    await bus.close()
  })

  it('maps real notification and GameMode changes with busy taking precedence', async () => {
    let inhibited = false
    let count = 0
    await bus.name(notifications)
    await bus.name(game)
    bus.property(notificationsPath, notifications, 'Inhibited', 'b', () => inhibited)
    bus.property(gamePath, game, 'ClientCount', 'i', () => count)
    await source.start()
    expect(source.hint()).toBeNull()
    inhibited = true
    let changed = once(events, 'hint', { signal: AbortSignal.timeout(2000) })
    bus.changed(notificationsPath, notifications, 'Inhibited', 'b', inhibited)
    await changed
    expect(source.hint()).toBe('quiet')
    count = 1
    changed = once(events, 'hint', { signal: AbortSignal.timeout(2000) })
    bus.service.emitSignal(gamePath, game, 'GameRegistered', 'i', [123])
    await changed
    expect(source.hint()).toBe('busy')
    bus.service.emitSignal(gamePath, game, 'GameRegistered', 'i', [123])
    bus.changed(notificationsPath, notifications, 'Inhibited', 'b', inhibited)
    await bus.drain()
    count = 0
    changed = once(events, 'hint', { signal: AbortSignal.timeout(2000) })
    bus.service.emitSignal(gamePath, game, 'GameUnregistered', 'i', [123])
    await changed
    expect(source.hint()).toBe('quiet')
    inhibited = false
    changed = once(events, 'hint', { signal: AbortSignal.timeout(2000) })
    bus.changed(notificationsPath, notifications, 'Inhibited', 'b', inhibited)
    await changed
    expect(source.hint()).toBeNull()
    expect(transitions).toEqual(['quiet', 'busy', 'quiet', null])
    source.stop()
    count = 1
    bus.service.emitSignal(gamePath, game, 'GameRegistered', 'i', [123])
    await bus.drain()
    expect(transitions).toEqual(['quiet', 'busy', 'quiet', null])
  })

  it('treats missing services as absent', async () => {
    await expect(source.start()).resolves.toBeUndefined()
    expect(source.hint()).toBeNull()
    expect(transitions).toEqual([])
  })

  it.each([
    { count: 2, inhibited: true, expected: 'busy' },
    { count: undefined, inhibited: true, expected: 'quiet' },
    { count: 1, inhibited: undefined, expected: 'busy' },
  ])('reads the initial hint $expected with count=$count and inhibited=$inhibited', async ({ count, inhibited, expected }) => {
    if (count !== undefined) {
      await bus.name(game)
      bus.property(gamePath, game, 'ClientCount', 'i', () => count)
    }
    if (inhibited !== undefined) {
      await bus.name(notifications)
      bus.property(notificationsPath, notifications, 'Inhibited', 'b', () => inhibited)
    }
    await source.start()
    expect(source.hint()).toBe(expected)
    expect(transitions).toEqual([])
  })

  it('does not coerce wrong-typed properties into hints', async () => {
    await bus.name(notifications)
    await bus.name(game)
    bus.property(notificationsPath, notifications, 'Inhibited', 's', () => 'true')
    bus.property(gamePath, game, 'ClientCount', 's', () => '2')
    await source.start()
    bus.changed(notificationsPath, notifications, 'Inhibited', 's', 'true')
    bus.service.emitSignal(gamePath, game, 'GameRegistered', 'i', [123])
    await bus.drain()
    expect(source.hint()).toBeNull()
    expect(transitions).toEqual([])
  })

  it.each([
    { name: game, path: gamePath, property: 'ClientCount', signature: 'i', value: 1, hint: 'busy' },
    { name: notifications, path: notificationsPath, property: 'Inhibited', signature: 'b', value: true, hint: 'quiet' },
  ])('clears the cached $hint hint when $name loses its owner', async ({ name, path, property, signature, value, hint }) => {
    await bus.name(name)
    bus.property(path, name, property, signature, () => value)
    await source.start()
    expect(source.hint()).toBe(hint)
    const off = bus.client.onNameOwnerChanged(name, (_, owner) => {
      if (!owner)
        events.dispatchEvent(new Event('gone'))
    })
    try {
      await bus.barrier()
      const gone = once(events, 'gone', { signal: AbortSignal.timeout(2000) })
      await bus.service.close()
      await gone
      expect(await bus.client.getNameOwner(name)).toBeNull()
      expect(source.hint()).toBeNull()
      expect(transitions).toEqual([null])
    }
    finally {
      off()
    }
  })

  it('recomputes precedence as GameMode and Notifications lose their owners', async () => {
    await bus.name(game)
    await bus.name(notifications)
    bus.property(gamePath, game, 'ClientCount', 'i', () => 1)
    bus.property(notificationsPath, notifications, 'Inhibited', 'b', () => true)
    await source.start()
    expect(source.hint()).toBe('busy')
    for (const name of [game, notifications]) {
      const off = bus.client.onNameOwnerChanged(name, (_, owner) => {
        if (!owner)
          events.dispatchEvent(new Event('gone'))
      })
      try {
        await bus.barrier()
        const gone = once(events, 'gone', { signal: AbortSignal.timeout(2000) })
        await bus.service.call({
          destination: 'org.freedesktop.DBus',
          path: '/org/freedesktop/DBus',
          interface: 'org.freedesktop.DBus',
          member: 'ReleaseName',
          signature: 's',
          body: [name],
        })
        await gone
      }
      finally {
        off()
      }
    }
    expect(source.hint()).toBeNull()
    expect(transitions).toEqual(['quiet', null])
  })
})
