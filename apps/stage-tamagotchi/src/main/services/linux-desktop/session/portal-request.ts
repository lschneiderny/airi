import type { DbusVariant } from '../dbus/transport'

import { randomUUID } from 'node:crypto'

import { array, literal, looseObject, parse, string, tuple, union, unknown } from 'valibot'

import { DbusTransport } from '../dbus/transport'

export const portal = 'org.freedesktop.portal.Desktop'
export const portalPath = '/org/freedesktop/portal/desktop'
export const shortcutsInterface = 'org.freedesktop.portal.GlobalShortcuts'
export const sessionInterface = 'org.freedesktop.portal.Session'
const requestInterface = 'org.freedesktop.portal.Request'

const responseSchema = tuple([union([literal(0), literal(1), literal(2)]), unknown()])
export const sessionSchema = looseObject({ session_handle: string() })
export const shortcutsSchema = array(tuple([string(), looseObject({ description: string(), trigger_description: string() })]))
export const bindSchema = looseObject({ shortcuts: shortcutsSchema })

export function portalToken(): string {
  return `airi_${randomUUID().replaceAll('-', '')}`
}

export function portalHandle(bus: DbusTransport, kind: 'session' | 'request', token: string): string {
  return `${portalPath}/${kind}/${bus.uniqueName.slice(1).replaceAll('.', '_')}/${token}`
}

/** Only missing objects/owners are harmless during teardown. */
export async function closePortalObject(bus: DbusTransport, owner: string, path: string, iface: string): Promise<void> {
  try {
    await bus.call({ destination: owner, path, interface: iface, member: 'Close' }, { timeout: 1500 })
  }
  catch (error) {
    if ([
      'org.freedesktop.DBus.Error.UnknownObject',
      'org.freedesktop.DBus.Error.UnknownMethod',
      'org.freedesktop.DBus.Error.NameHasNoOwner',
      'org.freedesktop.DBus.Error.ServiceUnknown',
    ].includes(DbusTransport.errorName(error) ?? '')) {
      return
    }
    throw error
  }
}

/**
 * Subscribe before invoking: a cached portal answer can precede the method reply.
 * One deadline covers both the method reply and the asynchronous Response.
 */
export async function portalRequest(bus: DbusTransport, options: {
  readonly owner: string
  readonly member: 'CreateSession' | 'BindShortcuts'
  readonly signature: string
  readonly body: unknown[]
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly requestOptions?: Record<string, DbusVariant>
}) {
  const token = portalToken()
  const path = portalHandle(bus, 'request', token)
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(new Error('Portal request timed out')), options.timeoutMs)
  const signal = AbortSignal.any([options.signal, deadline.signal])
  const response = Promise.withResolvers<unknown[]>()
  const off = bus.onSignal({ sender: options.owner, path, interface: requestInterface, member: 'Response' }, body => response.resolve(body))
  const aborted = () => response.reject(signal.reason)
  signal.addEventListener('abort', aborted, { once: true })
  const received = response.promise.then(body => parse(responseSchema, body))
  let completed = false
  try {
    signal.throwIfAborted()
    const [handle, [code, results]] = await Promise.all([bus.call<unknown>({
      destination: options.owner,
      path: portalPath,
      interface: shortcutsInterface,
      member: options.member,
      signature: options.signature,
      body: [...options.body, { ...options.requestOptions, handle_token: DbusTransport.variant('s', token) }],
    }, { signal }), received])
    if (handle !== path)
      throw new Error('Portal returned an unexpected request handle')
    completed = true
    return { code, results: DbusTransport.toPlain(results) }
  }
  finally {
    clearTimeout(timer)
    off()
    signal.removeEventListener('abort', aborted)
    deadline.abort()
    if (!completed)
      await closePortalObject(bus, options.owner, path, requestInterface)
  }
}
