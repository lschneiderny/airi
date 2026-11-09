import type { ShortcutBinding, ShortcutRegistrationResult } from '@proj-airi/stage-shared/global-shortcut'
import type { InferOutput } from 'valibot'

import { existsSync } from 'node:fs'

import { ShortcutFailureReasons } from '@proj-airi/stage-shared/global-shortcut'
import { parse } from 'valibot'

import { DbusTransport } from '../dbus/transport'
import { bindSchema, closePortalObject, portal, portalHandle, portalPath, portalRequest, portalToken, sessionInterface, sessionSchema, shortcutsInterface, shortcutsSchema } from './portal-request'
import { toXdgTrigger } from './xdg-trigger'

export { toXdgTrigger } from './xdg-trigger'

export interface PortalShortcut {
  readonly binding: ShortcutBinding
  /** Portal-localized display text, not an accelerator serialization. */
  readonly triggerDescription: string
}

/**
 * Owns portal sessions on a caller-owned, dedicated bus connection. Register must
 * be the first portal call on that connection. Reuse this driver until bus close.
 * bind replaces the entire desired set; each attempt needs a fresh session.
 * stop cancels in-flight work immediately; a later start/bind can recreate it.
 */
export class PortalShortcutsDriver {
  private owner: string | undefined
  private registeredOwner: string | undefined
  private session: string | undefined
  private attempted = false
  private confirmed = false
  private pendingChanges: InferOutput<typeof shortcutsSchema> | undefined
  private lifetime = new AbortController()
  private sessionLifetime = new AbortController()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly subscriptions: (() => void)[] = []
  private readonly bindings = new Map<string, ShortcutBinding>()
  private readonly shortcuts = new Map<string, PortalShortcut>()
  private readonly held = new Set<string>()
  private state: 'absent' | 'session' | 'bound' = 'absent'

  constructor(private readonly options: {
    readonly sessionBus: DbusTransport
    readonly onTriggered: (id: string, phase: 'down' | 'up') => void
    readonly onState: (state: 'absent' | 'session' | 'bound') => void
    readonly onError: (error: unknown) => void
    readonly flatpak?: boolean
    readonly requestTimeoutMs?: number
  }) {}

  start(): Promise<boolean> {
    return this.enqueue(async signal => this.connect(signal), false)
  }

  bind(bindings: readonly ShortcutBinding[]): Promise<ShortcutRegistrationResult[]> {
    return this.enqueue(signal => this.bindSession(bindings, signal), this.fail(bindings, ShortcutFailureReasons.Unsupported))
  }

  private async bindSession(bindings: readonly ShortcutBinding[], signal: AbortSignal): Promise<ShortcutRegistrationResult[]> {
    const invalid = bindings.some(binding => !binding.id || toXdgTrigger(binding.accelerator) === null)
      || new Set(bindings.map(binding => binding.id)).size !== bindings.length
    if (invalid)
      return bindings.map(({ id }) => ({ id, ok: false, reason: ShortcutFailureReasons.Invalid }))
    if (this.attempted)
      await this.closeSession()
    if (!await this.connect(signal) || !this.owner || !this.session)
      return this.fail(bindings, ShortcutFailureReasons.Unsupported)
    if (bindings.length === 0)
      return []
    this.attempted = true
    this.bindings.clear()
    for (const binding of bindings)
      this.bindings.set(binding.id, binding)
    const sessionSignal = AbortSignal.any([signal, this.sessionLifetime.signal])
    try {
      const response = await portalRequest(this.options.sessionBus, {
        owner: this.owner,
        member: 'BindShortcuts',
        signature: 'oa(sa{sv})sa{sv}',
        body: [this.session, bindings.map(binding => [binding.id, {
          description: DbusTransport.variant('s', binding.description ?? binding.id),
          preferred_trigger: DbusTransport.variant('s', toXdgTrigger(binding.accelerator)),
        }]), ''],
        signal: sessionSignal,
        timeoutMs: this.options.requestTimeoutMs ?? 60_000,
      })
      sessionSignal.throwIfAborted()
      const accepted = response.code === 0 ? parse(bindSchema, response.results).shortcuts : []
      const acceptedIds = new Set(accepted.map(([id]) => id))
      for (const id of this.bindings.keys()) {
        if (!acceptedIds.has(id))
          this.bindings.delete(id)
      }
      this.confirmed = response.code === 0
      this.updateShortcuts(this.confirmed ? this.pendingChanges ?? accepted : [])
      this.pendingChanges = undefined
      return bindings.map(({ id }) => this.shortcuts.has(id)
        ? { id, ok: true }
        : { id, ok: false, reason: ShortcutFailureReasons.Denied })
    }
    catch (error) {
      this.options.onError(error)
      this.updateShortcuts([])
      return this.fail(bindings, this.session ? ShortcutFailureReasons.Denied : ShortcutFailureReasons.Unsupported)
    }
  }

  list(): PortalShortcut[] {
    return [...this.shortcuts.values()]
  }

  /** Portal has no unbind method; replace its session with the remaining set. */
  unregisterById(id: string): Promise<ShortcutRegistrationResult[]> {
    return this.enqueue(signal => this.bindSession(this.list().filter(entry => entry.binding.id !== id).map(entry => entry.binding), signal), [])
  }

  async stop(): Promise<void> {
    this.lifetime.abort(new Error('Portal shortcuts stopped'))
    const pending = this.queue
    await this.closeSession()
    await pending
    this.lifetime = new AbortController()
  }

  private enqueue<T>(run: (signal: AbortSignal) => Promise<T>, cancelled: T): Promise<T> {
    const signal = this.lifetime.signal
    const next = this.queue.then(() => signal.aborted ? cancelled : run(signal))
    this.queue = next.then(() => undefined, error => this.options.onError(error))
    return next
  }

  private fail(bindings: readonly ShortcutBinding[], reason: typeof ShortcutFailureReasons.Denied | typeof ShortcutFailureReasons.Unsupported): ShortcutRegistrationResult[] {
    return bindings.map(({ id }) => ({ id, ok: false, reason }))
  }

  private async connect(signal: AbortSignal): Promise<boolean> {
    if (this.session)
      return true
    const bus = this.options.sessionBus
    this.sessionLifetime = new AbortController()
    const sessionSignal = AbortSignal.any([signal, this.sessionLifetime.signal])
    try {
      const owner = await bus.getNameOwner(portal)
      signal.throwIfAborted()
      if (!owner)
        return false
      this.owner = owner
      this.subscriptions.push(bus.onNameOwnerChanged(portal, (oldOwner, newOwner) => {
        if (oldOwner === owner && newOwner !== owner) {
          this.registeredOwner = undefined
          this.invalidate()
        }
      }))
      if (this.registeredOwner !== owner && !(this.options.flatpak ?? existsSync('/.flatpak-info'))) {
        await bus.call({ destination: owner, path: portalPath, interface: 'org.freedesktop.host.portal.Registry', member: 'Register', signature: 'sa{sv}', body: ['ai.moeru.airi', {}] }, { signal, timeout: 1500 })
        this.registeredOwner = owner
      }
      sessionSignal.throwIfAborted()
      const token = portalToken()
      this.session = portalHandle(bus, 'session', token)
      const session = this.session
      this.subscriptions.push(bus.onSignal({ sender: owner, path: session, interface: sessionInterface, member: 'Closed' }, () => this.invalidate()))
      for (const [member, phase] of [['Activated', 'down'], ['Deactivated', 'up']] as const) {
        this.subscriptions.push(bus.onSignal({ sender: owner, path: portalPath, interface: shortcutsInterface, member }, ([handle, id]) => {
          if (handle !== this.session || typeof id !== 'string' || !this.shortcuts.has(id))
            return
          if (phase === 'down')
            this.held.add(id)
          else
            this.held.delete(id)
          this.options.onTriggered(id, phase)
        }))
      }
      this.subscriptions.push(bus.onSignal({ sender: owner, path: portalPath, interface: shortcutsInterface, member: 'ShortcutsChanged' }, ([handle, shortcuts]) => {
        if (handle !== this.session)
          return
        try {
          const changed = parse(shortcutsSchema, DbusTransport.toPlain(shortcuts))
          // A change signal is not proof that BindShortcuts was accepted.
          if (this.confirmed)
            this.updateShortcuts(changed)
          else
            this.pendingChanges = changed
        }
        catch (error) {
          this.options.onError(error)
          this.pendingChanges = []
          this.updateShortcuts([])
        }
      }))
      const response = await portalRequest(bus, {
        owner,
        member: 'CreateSession',
        signature: 'a{sv}',
        body: [],
        requestOptions: { session_handle_token: DbusTransport.variant('s', token) },
        signal: sessionSignal,
        timeoutMs: this.options.requestTimeoutMs ?? 60_000,
      })
      signal.throwIfAborted()
      if (response.code !== 0 || parse(sessionSchema, response.results).session_handle !== session || this.session !== session)
        throw new Error('Portal did not create the requested session')
      this.publish('session')
      return true
    }
    catch (error) {
      this.options.onError(error)
      await this.closeSession()
      return false
    }
  }

  private updateShortcuts(shortcuts: InferOutput<typeof shortcutsSchema>): void {
    this.shortcuts.clear()
    for (const [id, details] of shortcuts) {
      const binding = this.bindings.get(id)
      if (binding && details.trigger_description)
        this.shortcuts.set(id, { binding, triggerDescription: details.trigger_description })
    }
    for (const id of this.held) {
      if (!this.shortcuts.has(id)) {
        this.held.delete(id)
        this.options.onTriggered(id, 'up')
      }
    }
    this.publish(this.session ? [...this.shortcuts.values()].some(entry => entry.binding.receiveKeyUps) ? 'bound' : 'session' : 'absent')
  }

  private publish(state: 'absent' | 'session' | 'bound'): void {
    if (state !== this.state) {
      this.state = state
      this.options.onState(state)
    }
  }

  private invalidate(): void {
    this.sessionLifetime.abort(new Error('Portal session ended'))
    for (const off of this.subscriptions.splice(0))
      off()
    this.session = undefined
    this.owner = undefined
    this.attempted = false
    this.confirmed = false
    this.pendingChanges = undefined
    this.bindings.clear()
    this.updateShortcuts([])
  }

  private async closeSession(): Promise<void> {
    const session = this.session
    const owner = this.owner
    this.invalidate()
    if (session && owner)
      await closePortalObject(this.options.sessionBus, owner, session, sessionInterface)
  }
}
