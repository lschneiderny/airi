import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'

import { DbusTransport } from '../dbus/transport'

/** Every connection, exported fake and signal stays on this test-owned daemon. */
export class PrivateBus {
  private daemon: ChildProcessWithoutNullStreams | undefined
  private readonly connections: DbusTransport[] = []
  private clientConnection: DbusTransport | undefined
  private serviceConnection: DbusTransport | undefined
  private owner = ''
  private sender = ''

  get client(): DbusTransport {
    if (!this.clientConnection)
      throw new Error('Private client has not started')
    return this.clientConnection
  }

  get service(): DbusTransport {
    if (!this.serviceConnection)
      throw new Error('Private service has not started')
    return this.serviceConnection
  }

  async start(): Promise<void> {
    this.daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: 'pipe' })
    const lines = createInterface({ input: this.daemon.stdout })
    try {
      const [address] = await once(lines, 'line', { signal: AbortSignal.timeout(2000) })
      if (typeof address !== 'string' || !address.startsWith('unix:'))
        throw new Error('Private daemon did not return an address')
      this.clientConnection = await DbusTransport.session(address)
      this.connections.push(this.client)
      this.serviceConnection = await DbusTransport.session(address)
      this.connections.push(this.service)
      await this.client.requestName('ai.airi.SessionClient')
      await this.service.requestName('ai.airi.SessionService')
      this.owner = await this.service.getNameOwner('ai.airi.SessionClient') ?? ''
      this.sender = await this.client.getNameOwner('ai.airi.SessionService') ?? ''
    }
    finally {
      lines.close()
    }
  }

  async name(name: string): Promise<void> {
    if (!await this.service.requestName(name))
      throw new Error(`Private service failed to own ${name}`)
  }

  method(path: string, iface: string, member: string, signature: string, outSignature: string, handler: (...args: unknown[]) => unknown): void {
    this.service.exportObject(path, {
      name: iface,
      methods: { [member]: { signature, outSignature, handler } },
    }, { allowedSender: () => this.owner })
  }

  property(path: string, iface: string, name: string, signature: string, get: () => unknown): void {
    this.service.exportReadOnlyProperties(path, iface, {
      [name]: { signature, get },
    })
  }

  changed(path: string, iface: string, name: string, signature: string, value: unknown): void {
    this.service.emitSignal(path, 'org.freedesktop.DBus.Properties', 'PropertiesChanged', 'sa{sv}as', [
      iface,
      [[name, [signature, value]]],
      [],
    ])
  }

  async barrier(): Promise<void> {
    await this.client.call({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'GetId' })
  }

  /** A fence follows all fake signals; a reply then drains triggered reads. */
  async drain(): Promise<void> {
    const events = new EventTarget()
    const off = this.client.onSignal({ sender: this.sender, path: '/fence', interface: 'ai.airi.Fence', member: 'Done' }, () => events.dispatchEvent(new Event('done')))
    try {
      await this.barrier()
      const done = once(events, 'done', { signal: AbortSignal.timeout(2000) })
      this.service.emitSignal('/fence', 'ai.airi.Fence', 'Done', '', [])
      await done
      await this.barrier()
    }
    finally {
      off()
    }
  }

  async close(): Promise<void> {
    try {
      if (this.daemon && this.daemon.exitCode === null && this.daemon.signalCode === null) {
        const exited = once(this.daemon, 'exit', { signal: AbortSignal.timeout(2000) })
        this.daemon.kill()
        await exited
      }
    }
    finally {
      await Promise.all(this.connections.map(connection => connection.close()))
    }
  }
}
