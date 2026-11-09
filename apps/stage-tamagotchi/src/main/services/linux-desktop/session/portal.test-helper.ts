import { array, looseObject, parse, string, tuple } from 'valibot'

import { DbusTransport } from '../dbus/transport'
import { portal, portalHandle, portalPath, sessionInterface, shortcutsInterface } from './portal-request'
import { PrivateBus } from './private-bus.test-helper'

/** Wire-level portal fake, including the one-bind-attempt-per-session rule. */
export class FakePortal extends PrivateBus {
  readonly events = new EventTarget()
  registered = false
  flatpak = false
  registerCount = 0
  createCount = 0
  code = 0
  responseCode = 0
  hold: 'CreateSession' | 'BindShortcuts' | undefined
  malformed: 'session' | 'shortcuts' | undefined
  acceptedIds: string[] | undefined
  changeBeforeResponse: unknown[] | undefined
  session = ''
  requested: [string, { description: string, preferred_trigger: string }][] = []
  readonly closedSessions: string[] = []
  readonly closedRequests: string[] = []
  private readonly attempted = new Set<string>()

  async install(): Promise<void> {
    await this.name(portal)
    this.service.exportObject(portalPath, {
      name: 'org.freedesktop.host.portal.Registry',
      methods: {
        Register: { signature: 'sa{sv}', outSignature: '', handler: (appId) => {
          if (this.registered || this.flatpak || appId !== 'ai.moeru.airi')
            throw new Error('Invalid registration')
          this.registered = true
          this.registerCount++
        } },
      },
    }, { allowedSender: () => this.client.uniqueName })
    this.property(portalPath, shortcutsInterface, 'version', 'u', () => 2)
    this.service.exportObject(portalPath, {
      name: shortcutsInterface,
      methods: {
        CreateSession: { signature: 'a{sv}', outSignature: 'o', handler: (raw) => {
          if (!this.registered && !this.flatpak)
            throw new Error('Register must precede CreateSession')
          const options = parse(looseObject({ handle_token: string(), session_handle_token: string() }), DbusTransport.toPlain(raw))
          this.session = portalHandle(this.client, 'session', options.session_handle_token)
          const session = this.session
          this.createCount++
          this.method(session, sessionInterface, 'Close', '', '', () => this.closedSessions.push(session))
          const result = { session_handle: DbusTransport.variant('s', this.malformed === 'session' ? '/wrong' : session) }
          return this.respond('CreateSession', options.handle_token, this.responseCode, result)
        } },
        BindShortcuts: { signature: 'oa(sa{sv})sa{sv}', outSignature: 'o', handler: (session, shortcuts, _parent, raw) => {
          if (typeof session !== 'string' || this.attempted.has(session))
            throw new Error('Only one bind attempt is allowed per session')
          this.attempted.add(session)
          this.requested = parse(array(tuple([string(), looseObject({ description: string(), preferred_trigger: string() })])), DbusTransport.toPlain(shortcuts))
          const options = parse(looseObject({ handle_token: string() }), DbusTransport.toPlain(raw))
          if (this.changeBeforeResponse)
            this.changed(this.changeBeforeResponse)
          return this.respond('BindShortcuts', options.handle_token, this.code, {
            shortcuts: this.malformed === 'shortcuts' ? DbusTransport.variant('s', 'bad') : DbusTransport.variant('a(sa{sv})', this.bound()),
          })
        } },
      },
    }, { allowedSender: () => this.client.uniqueName })
  }

  bound(trigger = 'Ctrl+Shift+Space') {
    return this.requested.filter(([id]) => !this.acceptedIds || this.acceptedIds.includes(id)).map(([id, details]) => [id, {
      description: DbusTransport.variant('s', details.description),
      trigger_description: DbusTransport.variant('s', trigger),
    }])
  }

  changed(shortcuts: unknown = this.bound()): void {
    this.service.emitSignal(portalPath, shortcutsInterface, 'ShortcutsChanged', 'oa(sa{sv})', [this.session, shortcuts])
  }

  key(member: 'Activated' | 'Deactivated', id = 'voice-push-to-talk', session = this.session): void {
    this.service.emitSignal(portalPath, shortcutsInterface, member, 'osta{sv}', [session, id, 1n, {}])
  }

  private respond(member: string, token: string, code: number, results: unknown): string {
    const path = portalHandle(this.client, 'request', token)
    this.method(path, 'org.freedesktop.portal.Request', 'Close', '', '', () => this.closedRequests.push(path))
    if (this.hold !== member)
      this.service.emitSignal(path, 'org.freedesktop.portal.Request', 'Response', 'ua{sv}', [code, results])
    this.events.dispatchEvent(new Event(member))
    return path
  }
}
