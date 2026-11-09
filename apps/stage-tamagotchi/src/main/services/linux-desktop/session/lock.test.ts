import { once } from 'node:events'
import { pid } from 'node:process'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LockSource, lockState } from './lock'
import { PrivateBus } from './private-bus.test-helper'

describe('lock state mapping', () => {
  it.each([
    [true, true],
    [false, false],
    [null, null],
    [undefined, null],
    ['true', null],
    [1, null],
    [[], null],
    [{ locked: true }, null],
  ])('accepts only a boolean from %s', (value, expected) => {
    expect(lockState(value)).toBe(expected)
  })
})

describe('lock source on a private daemon', () => {
  let bus: PrivateBus
  let system: PrivateBus
  let source: LockSource
  let transitions: boolean[]
  let events: EventTarget
  const saver = 'org.freedesktop.ScreenSaver'
  const saverPath = '/org/freedesktop/ScreenSaver'
  const login = 'org.freedesktop.login1'
  const sessionPath = '/org/freedesktop/login1/session/test'

  beforeEach(async () => {
    bus = new PrivateBus()
    system = new PrivateBus()
    await bus.start()
    await system.start()
    transitions = []
    events = new EventTarget()
    source = new LockSource({
      sessionBus: bus.client,
      systemBus: system.client,
      onLock: (locked) => {
        transitions.push(locked)
        events.dispatchEvent(new Event('lock'))
      },
    })
  })

  afterEach(async () => {
    source?.stop()
    await Promise.all([bus.close(), system.close()])
  })

  async function screenSaver(read: () => unknown = () => false, signature = 'b'): Promise<void> {
    await bus.name(saver)
    bus.method(saverPath, saver, 'GetActive', '', signature, read)
  }

  async function flip(locked: boolean): Promise<void> {
    const changed = once(events, 'lock', { signal: AbortSignal.timeout(2000) })
    bus.service.emitSignal(saverPath, saver, 'ActiveChanged', 'b', [locked])
    await changed
  }

  it('screensaver false -> true -> false emits exactly two transitions despite duplicate signals', async () => {
    await screenSaver()
    expect(await source.start()).toBe('screensaver')
    expect(await source.start()).toBe('screensaver')
    await flip(true)
    bus.service.emitSignal(saverPath, saver, 'ActiveChanged', 'b', [true])
    await bus.drain()
    await flip(false)
    bus.service.emitSignal(saverPath, saver, 'ActiveChanged', 'b', [false])
    await bus.drain()
    expect(transitions).toEqual([true, false])
  })

  it('resolves null without throwing when neither logind nor ScreenSaver exists', async () => {
    await expect(source.start()).resolves.toBeNull()
    expect(transitions).toEqual([])
  })

  it('prefers read-only logind LockedHint and deduplicates both sources', async () => {
    let locked = false
    await screenSaver()
    await system.name(login)
    system.method('/org/freedesktop/login1', `${login}.Manager`, 'GetSessionByPID', 'u', 'o', (requestedPid) => {
      expect(requestedPid).toBe(pid)
      return sessionPath
    })
    system.property(sessionPath, `${login}.Session`, 'LockedHint', 'b', () => locked)
    expect(await source.start()).toBe('logind')
    for (const value of [true, false]) {
      locked = value
      const changed = once(events, 'lock', { signal: AbortSignal.timeout(2000) })
      system.changed(sessionPath, `${login}.Session`, 'LockedHint', 'b', value)
      await changed
      bus.service.emitSignal(saverPath, saver, 'ActiveChanged', 'b', [value])
      system.changed(sessionPath, `${login}.Session`, 'LockedHint', 'b', value)
      await Promise.all([bus.drain(), system.drain()])
    }
    expect(transitions).toEqual([true, false])
  })

  it('falls back when logind returns a wrong-typed LockedHint', async () => {
    await screenSaver()
    await system.name(login)
    system.method('/org/freedesktop/login1', `${login}.Manager`, 'GetSessionByPID', 'u', 'o', () => sessionPath)
    system.property(sessionPath, `${login}.Session`, 'LockedHint', 's', () => 'true')
    expect(await source.start()).toBe('screensaver')
    await flip(true)
    expect(transitions).toEqual([true])
  })

  it('preserves consecutive logind payload transitions without rereading the final state', async () => {
    await system.name(login)
    system.method('/org/freedesktop/login1', `${login}.Manager`, 'GetSessionByPID', 'u', 'o', () => sessionPath)
    system.property(sessionPath, `${login}.Session`, 'LockedHint', 'b', () => false)
    expect(await source.start()).toBe('logind')
    system.changed(sessionPath, `${login}.Session`, 'LockedHint', 'b', true)
    system.changed(sessionPath, `${login}.Session`, 'LockedHint', 'b', true)
    system.changed(sessionPath, `${login}.Session`, 'LockedHint', 's', 'true')
    system.changed(sessionPath, `${login}.Session`, 'LockedHint', 'b', false)
    system.changed(sessionPath, `${login}.Session`, 'LockedHint', 'b', false)
    await system.drain()
    expect(transitions).toEqual([true, false])
  })

  it('rereads logind state when LockedHint is invalidated without a value', async () => {
    let locked = false
    await system.name(login)
    system.method('/org/freedesktop/login1', `${login}.Manager`, 'GetSessionByPID', 'u', 'o', () => sessionPath)
    system.property(sessionPath, `${login}.Session`, 'LockedHint', 'b', () => locked)
    expect(await source.start()).toBe('logind')
    locked = true
    const changed = once(events, 'lock', { signal: AbortSignal.timeout(2000) })
    system.service.emitSignal(sessionPath, 'org.freedesktop.DBus.Properties', 'PropertiesChanged', 'sa{sv}as', [
      `${login}.Session`,
      {},
      ['LockedHint'],
    ])
    await changed
    expect(transitions).toEqual([true])
  })

  it('rejects wrong-typed ScreenSaver state and ignores malformed pushes', async () => {
    await screenSaver(() => 'true', 's')
    expect(await source.start()).toBeNull()
    expect(transitions).toEqual([])
    source.stop()
    // The fake switches to a boolean reply on restart.
    bus.method(saverPath, saver, 'GetActive', '', 'b', () => false)
    expect(await source.start()).toBe('screensaver')
    bus.service.emitSignal(saverPath, saver, 'ActiveChanged', 's', ['true'])
    await bus.drain()
    await flip(true)
    expect(transitions).toEqual([true])
  })

  it('stops receiving transitions when disposed', async () => {
    await screenSaver()
    await source.start()
    source.stop()
    bus.service.emitSignal(saverPath, saver, 'ActiveChanged', 'b', [true])
    await bus.drain()
    expect(transitions).toEqual([])
  })

  it('discards a late snapshot after stop and restart', async () => {
    const pending = Promise.withResolvers<boolean>()
    let reads = 0
    await screenSaver(() => {
      reads++
      if (reads === 1) {
        events.dispatchEvent(new Event('snapshot'))
        return pending.promise
      }
      return false
    })
    const entered = once(events, 'snapshot', { signal: AbortSignal.timeout(2000) })
    const oldStart = source.start()
    await entered
    source.stop()
    expect(await source.start()).toBe('screensaver')
    pending.resolve(true)
    expect(await oldStart).toBeNull()
    bus.service.emitSignal(saverPath, saver, 'ActiveChanged', 'b', [false])
    await bus.drain()
    expect(transitions).toEqual([])
  })

  it('bounds startup when owned services never reply', async () => {
    await system.name(login)
    system.method('/org/freedesktop/login1', `${login}.Manager`, 'GetSessionByPID', 'u', 'o', () => new Promise(() => {}))
    await screenSaver(() => new Promise(() => {}))
    await expect(source.start()).resolves.toBeNull()
    expect(transitions).toEqual([])
  }, 3500)
})
