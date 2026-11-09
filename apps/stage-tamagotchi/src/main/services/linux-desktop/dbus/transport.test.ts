import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { DbusTransport } from './transport'

describe('dbusTransport on a private daemon', () => {
  let daemon: ChildProcessWithoutNullStreams
  let first: DbusTransport
  let second: DbusTransport
  let owner: string
  const destination = 'ai.airi.TransportTest'
  const path = '/ai/airi/TransportTest'
  const iface = 'ai.airi.TransportTest'
  const busName = 'org.freedesktop.DBus'
  const busPath = '/org/freedesktop/DBus'

  // Every asynchronous receipt has a deadline; readiness comes from stdout.
  beforeAll(async () => {
    daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: 'pipe' })
    const lines = createInterface({ input: daemon.stdout })
    try {
      const [address] = await once(lines, 'line', { signal: AbortSignal.timeout(2000) })
      if (typeof address !== 'string' || !address.startsWith('unix:'))
        throw new Error(`Unexpected private bus address: ${address}`)
      first = await DbusTransport.session(address)
      second = await DbusTransport.session(address)
      expect(await first.requestName(destination)).toBe(true)
      expect(await second.requestName('ai.airi.TransportPeer')).toBe(true)
      const peerOwner = await first.getNameOwner('ai.airi.TransportPeer')
      if (peerOwner === null)
        throw new Error('Private peer did not acquire its name')
      owner = peerOwner
    }
    finally {
      lines.close()
    }
  }, 5000)

  afterAll(async () => {
    try {
      await second?.close()
      await first?.close()
    }
    finally {
      if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
        const exited = once(daemon, 'exit', { signal: AbortSignal.timeout(2000) })
        daemon.kill()
        await exited
      }
    }
  })

  it('answers an exported method for the allowed unique sender', async () => {
    const received = vi.fn()
    const unexport = first.exportObject(path, { name: iface, methods: { Notify: { signature: 's', outSignature: '', handler: received } } }, { allowedSender: () => owner })
    try {
      await expect(second.call({ destination, path, interface: iface, member: 'Notify', signature: 's', body: ['allowed'] })).resolves.toBeUndefined()
      expect(received).toHaveBeenCalledExactlyOnceWith('allowed')
    }
    finally {
      unexport()
    }
  })

  it('rejects an unexpected sender with org.freedesktop.DBus.Error.AccessDenied', async () => {
    const received = vi.fn()
    const unexport = first.exportObject(path, { name: iface, methods: { Notify: { signature: 's', outSignature: '', handler: received } } }, { allowedSender: () => ':999.999' })
    try {
      await expect(second.call({ destination, path, interface: iface, member: 'Notify', signature: 's', body: ['denied'] })).rejects.toMatchObject({ dbusName: 'org.freedesktop.DBus.Error.AccessDenied' })
      expect(received).not.toHaveBeenCalled()
    }
    finally {
      unexport()
    }
  })

  it('rejects every sender while the allowed owner is absent', async () => {
    const unexport = first.exportObject(path, { name: iface, methods: { Notify: { signature: '', outSignature: '', handler: () => {} } } }, { allowedSender: () => null })
    try {
      await expect(second.call({ destination, path, interface: iface, member: 'Notify' })).rejects.toMatchObject({ dbusName: 'org.freedesktop.DBus.Error.AccessDenied' })
    }
    finally {
      unexport()
    }
  })

  it.each([
    { name: 'synchronous', handler: () => '[123,456]' },
    { name: 'asynchronous', handler: async () => '[123,456]' },
  ])('returns a string reply from an allowed $name handler', async ({ handler }) => {
    const unexport = first.exportObject(path, { name: iface, methods: { OwnPids: { signature: '', outSignature: 's', handler } } }, { allowedSender: () => owner })
    try {
      await expect(second.call<string>({ destination, path, interface: iface, member: 'OwnPids' })).resolves.toBe('[123,456]')
    }
    finally {
      unexport()
    }
  })

  it('delivers matched signals and stops delivery after unsubscribe', async () => {
    const events = new EventTarget()
    const received = vi.fn((body: unknown[]) => {
      if (body[0] === 'ai.airi.SignalTest')
        events.dispatchEvent(new Event('received'))
    })
    const unsubscribe = first.onSignal({ sender: busName, path: busPath, interface: busName, member: 'NameOwnerChanged' }, received)
    try {
      await first.call({ destination: busName, path: busPath, interface: busName, member: 'GetId' })
      const delivered = once(events, 'received', { signal: AbortSignal.timeout(2000) })
      expect(await second.requestName('ai.airi.SignalTest')).toBe(true)
      await delivered
      expect(received).toHaveBeenCalledWith(['ai.airi.SignalTest', '', owner])
      unsubscribe()
      await first.call({ destination: busName, path: busPath, interface: busName, member: 'GetId' })
      received.mockClear()
      await second.requestName('ai.airi.AfterUnsubscribe')
      // A reply on the receiver drains preceding bus messages without a sleep.
      await first.call({ destination: busName, path: busPath, interface: busName, member: 'GetId' })
      expect(received).not.toHaveBeenCalled()
    }
    finally {
      unsubscribe()
    }
  })

  it('reads D-Bus properties as plain values', async () => {
    const features = await first.getProperty<string[]>(busName, busPath, busName, 'Features')
    expect(Array.isArray(features)).toBe(true)
    expect(features).toContain('ActivatableServicesChanged')
  })

  it('returns null when a well-known name has no owner', async () => {
    expect(await first.getNameOwner('ai.airi.Absent')).toBeNull()
  })

  it('reports a name conflict without queueing for ownership', async () => {
    expect(await second.requestName(destination)).toBe(false)
  })

  it('fires NameOwnerChanged when the second connection closes', async () => {
    const events = new EventTarget()
    const changed = vi.fn((oldOwner: string, newOwner: string) => {
      if (oldOwner === owner && newOwner === '')
        events.dispatchEvent(new Event('lost'))
    })
    const unsubscribe = first.onNameOwnerChanged('ai.airi.TransportPeer', changed)
    try {
      await first.call({ destination: busName, path: busPath, interface: busName, member: 'GetId' })
      const lost = once(events, 'lost', { signal: AbortSignal.timeout(2000) })
      await second.close()
      await lost
      expect(changed).toHaveBeenCalledExactlyOnceWith(owner, '')
    }
    finally {
      unsubscribe()
    }
  })

  it('rejects a nonexistent socket within 2 seconds and names its address', async () => {
    const start = performance.now()
    await expect(DbusTransport.session('unix:path=/nonexistent')).rejects.toThrow('unix:path=/nonexistent')
    expect(performance.now() - start).toBeLessThan(2000)
  }, 2000)
})
