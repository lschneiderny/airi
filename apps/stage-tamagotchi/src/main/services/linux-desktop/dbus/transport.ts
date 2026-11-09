import { env } from 'node:process'

import * as dbus from 'dbus-native'

interface MethodCall {
  readonly destination: string
  readonly path: string
  readonly interface: string
  readonly member: string
  readonly signature?: string
  readonly body?: unknown[]
}

interface SignalMatch {
  readonly sender?: string
  readonly path?: string
  readonly interface: string
  readonly member: string
}

interface ExportedInterface {
  readonly name: string
  readonly methods: Record<string, {
    readonly signature: string
    readonly outSignature: string
    readonly handler: (...args: unknown[]) => unknown
  }>
}

const busName = 'org.freedesktop.DBus'
const busPath = '/org/freedesktop/DBus'

/** Owns one bus connection. Subscriptions and exports end when it closes. */
export class DbusTransport {
  private failure: Error | undefined
  private readonly disposers = new Set<() => void>()

  private constructor(private readonly bus: dbus.MessageBus) {
    bus.connection.on('error', (error) => {
      this.failure = error
    })
  }

  static async session(address = env.DBUS_SESSION_BUS_ADDRESS): Promise<DbusTransport> {
    return DbusTransport.connect(() => dbus.sessionBus({ busAddress: address }), address ?? 'session bus')
  }

  static async system(): Promise<DbusTransport> {
    return DbusTransport.connect(() => dbus.systemBus(), env.DBUS_SYSTEM_BUS_ADDRESS || 'unix:path=/var/run/dbus/system_bus_socket')
  }

  private static async connect(create: () => dbus.MessageBus, address: string): Promise<DbusTransport> {
    let transport: DbusTransport | undefined
    try {
      transport = new DbusTransport(create())
      // GetId crosses authentication and Hello, so returning proves the bus is ready.
      await transport.bus.invoke<string>({ destination: busName, path: busPath, interface: busName, member: 'GetId' }, { timeout: 1500 })
      return transport
    }
    catch (error) {
      await transport?.close()
      throw new Error(`D-Bus connection to ${address} failed`, { cause: error })
    }
  }

  async call<T>(msg: MethodCall): Promise<T> {
    if (this.failure)
      throw this.failure
    return this.bus.invoke<T>({ ...msg })
  }

  emitSignal(path: string, iface: string, member: string, signature: string, body: unknown[]): void {
    this.bus.sendSignal(path, iface, member, signature, body)
  }

  /** Exposes synchronous getters publicly through the standard Properties API. */
  exportReadOnlyProperties(path: string, iface: string, properties: Record<string, {
    readonly signature: string
    readonly get: () => unknown
  }>): () => void {
    const descriptors: Record<string, dbus.PropertyDescriptor> = {}
    const implementation: Record<string, unknown> = {}
    for (const [name, property] of Object.entries(properties)) {
      descriptors[name] = { type: property.signature, access: 'read' }
      Object.defineProperty(implementation, name, { enumerable: true, get: property.get })
    }
    this.bus.exportInterface(implementation, path, { name: iface, properties: descriptors })
    const unexport = () => {
      this.bus.unexportInterface(path, iface)
      this.disposers.delete(unexport)
    }
    this.disposers.add(unexport)
    return unexport
  }

  async getProperty<T>(destination: string, path: string, iface: string, name: string): Promise<T> {
    const value = await this.call<unknown>({ destination, path, interface: 'org.freedesktop.DBus.Properties', member: 'Get', signature: 'ss', body: [iface, name] })
    return dbus.variantValue<T>(value)
  }

  /**
   * Adds the match before subsequent calls on this connection. Callers needing a
   * cross-connection barrier can await a call before asking the peer to emit.
   */
  onSignal(match: SignalMatch, cb: (body: unknown[]) => void): () => void {
    const fields = { type: 'signal', ...match }
    const rule = Object.entries(fields).map(([key, value]) => {
      // Match values are D-Bus names and paths, not arbitrary quoted expressions.
      if (!/^[\w./:-]+$/.test(value))
        throw new TypeError(`Invalid D-Bus match ${key}: ${value}`)
      return `${key}='${value}'`
    }).join(',')
    let active = true
    const listener = (message: dbus.Message) => {
      if (!active || message.type !== dbus.messageType.signal
        || message.interface !== match.interface || message.member !== match.member
        || (match.path && message.path !== match.path)) {
        return
      }
      if (!match.sender || match.sender.startsWith(':') || match.sender === busName) {
        if (!match.sender || message.sender === match.sender)
          cb(message.body ?? [])
        return
      }
      // The wire carries unique senders even when the match names a service.
      this.getNameOwner(match.sender).then((owner) => {
        if (active && owner !== null && owner === message.sender)
          cb(message.body ?? [])
      }).catch(error => this.recordFailure(error))
    }
    this.bus.connection.on('message', listener)
    this.bus.addMatch(rule).catch(error => this.recordFailure(error))
    const unsubscribe = () => {
      if (!active)
        return
      active = false
      this.bus.connection.removeListener('message', listener)
      this.bus.removeMatch(rule).catch(error => this.recordFailure(error))
      this.disposers.delete(unsubscribe)
    }
    this.disposers.add(unsubscribe)
    return unsubscribe
  }

  /** Signatures describe the input and output arguments on the wire. */
  exportObject(path: string, iface: ExportedInterface, opts: { readonly allowedSender: () => string | null }): () => void {
    const methods: Record<string, dbus.MethodDescriptor> = {}
    const implementation: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    for (const [name, method] of Object.entries(iface.methods)) {
      methods[name] = [method.signature, method.outSignature, [], []]
      implementation[name] = async (...args) => {
        // dbus-native appends the original message after the input arguments.
        const message = args.pop()
        const sender = typeof message === 'object' && message !== null && 'sender' in message ? message.sender : undefined
        const allowed = opts.allowedSender()
        if (allowed === null || sender !== allowed) {
          throw Object.assign(new Error('Caller is not the allowed D-Bus sender'), {
            dbusName: 'org.freedesktop.DBus.Error.AccessDenied',
          })
        }
        const result = await method.handler(...args)
        return method.outSignature ? result : null
      }
    }
    this.bus.exportInterface(implementation, path, { name: iface.name, methods })
    const unexport = () => {
      this.bus.unexportInterface(path, iface.name)
      this.disposers.delete(unexport)
    }
    this.disposers.add(unexport)
    return unexport
  }

  async requestName(name: string): Promise<boolean> {
    const result = await this.call<number>({ destination: busName, path: busPath, interface: busName, member: 'RequestName', signature: 'su', body: [name, 4] })
    return result === 1 || result === 4
  }

  async getNameOwner(name: string): Promise<string | null> {
    try {
      return await this.call<string>({ destination: busName, path: busPath, interface: busName, member: 'GetNameOwner', signature: 's', body: [name] })
    }
    catch (error) {
      if (error instanceof dbus.DBusError && error.dbusName === 'org.freedesktop.DBus.Error.NameHasNoOwner')
        return null
      throw error
    }
  }

  onNameOwnerChanged(name: string, cb: (oldOwner: string, newOwner: string) => void): () => void {
    return this.onSignal({ sender: busName, path: busPath, interface: busName, member: 'NameOwnerChanged' }, ([changedName, oldOwner, newOwner]) => {
      if (changedName === name && typeof oldOwner === 'string' && typeof newOwner === 'string')
        cb(oldOwner, newOwner)
    })
  }

  async close(): Promise<void> {
    for (const dispose of this.disposers)
      dispose()
    await this.bus.close()
  }

  private recordFailure(error: unknown): void {
    this.failure = error instanceof Error ? error : new Error('D-Bus subscription failed', { cause: error })
  }
}
