import type { DbusTransport } from '../dbus/transport'

import { pid } from 'node:process'

const login = 'org.freedesktop.login1'
const loginSession = `${login}.Session`
const screenSaver = 'org.freedesktop.ScreenSaver'
const screenSaverPath = '/org/freedesktop/ScreenSaver'
const properties = 'org.freedesktop.DBus.Properties'

export function lockState(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** Buses belong to the bridge; this source owns only its subscriptions. */
export class LockSource {
  private state: boolean | null = null
  private generation = 0
  private revision = 0
  private unsubscribe: (() => void) | undefined
  private starting: Promise<'logind' | 'screensaver' | null> | undefined

  constructor(private readonly options: {
    readonly systemBus: DbusTransport | null
    readonly sessionBus: DbusTransport
    readonly onLock: (locked: boolean) => void
  }) {}

  start(): Promise<'logind' | 'screensaver' | null> {
    this.starting ??= this.connect(this.generation)
    return this.starting
  }

  stop(): void {
    this.generation++
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.starting = undefined
    this.state = null
  }

  private async connect(generation: number): Promise<'logind' | 'screensaver' | null> {
    const { systemBus, sessionBus } = this.options
    const path = await this.read(async () => {
      if (!systemBus || await systemBus.getNameOwner(login) === null)
        return null
      return systemBus.call<unknown>({
        destination: login,
        path: '/org/freedesktop/login1',
        interface: `${login}.Manager`,
        member: 'GetSessionByPID',
        signature: 'u',
        body: [pid],
      })
    })
    if (generation !== this.generation)
      return null
    if (systemBus && typeof path === 'string' && /^\/(?:\w+\/)*\w+$/.test(path)) {
      const read = () => systemBus.getProperty<unknown>(login, path, loginSession, 'LockedHint')
      this.unsubscribe = systemBus.onSignal({ sender: login, path, interface: properties, member: 'PropertiesChanged' }, ([iface, changed, invalidated]) => {
        if (iface !== loginSession || generation !== this.generation)
          return
        if (typeof changed === 'object' && changed !== null && 'LockedHint' in changed) {
          const state = lockState(changed.LockedHint)
          if (state !== null) {
            // Preserve each push; a later read may already see the final state.
            this.revision++
            this.update(state)
          }
        }
        else if (Array.isArray(invalidated) && invalidated.includes('LockedHint')) {
          void this.refresh(read, generation)
        }
      })
      const state = await this.refresh(read, generation)
      if (generation !== this.generation)
        return null
      if (state !== null)
        return 'logind'
      this.unsubscribe()
      this.unsubscribe = undefined
    }

    if (await this.read(() => sessionBus.getNameOwner(screenSaver)) === null || generation !== this.generation)
      return null
    this.unsubscribe = sessionBus.onSignal({ sender: screenSaver, path: screenSaverPath, interface: screenSaver, member: 'ActiveChanged' }, ([value]) => {
      // An in-flight initial snapshot must not overwrite a newer push.
      this.revision++
      if (generation === this.generation)
        this.update(lockState(value))
    })
    const state = await this.refresh(() => sessionBus.call<unknown>({
      destination: screenSaver,
      path: screenSaverPath,
      interface: screenSaver,
      member: 'GetActive',
    }), generation)
    if (generation !== this.generation)
      return null
    if (state !== null)
      return 'screensaver'
    this.unsubscribe?.()
    this.unsubscribe = undefined
    return null
  }

  private async refresh(read: () => Promise<unknown>, generation: number): Promise<boolean | null> {
    const revision = ++this.revision
    const state = lockState(await this.read(read))
    if (generation === this.generation && revision === this.revision)
      this.update(state)
    return state
  }

  private update(state: boolean | null): void {
    if (state === null || state === this.state)
      return
    const previous = this.state
    this.state = state
    // The first sample establishes a baseline; only changes are events.
    if (previous !== null)
      this.options.onLock(state)
  }

  private async read(read: () => Promise<unknown>): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // A service can own its name without ever answering. Bound every probe.
      return await Promise.race([
        read().catch((error: unknown) => {
          if (error instanceof Error && 'dbusName' in error)
            return null
          throw error
        }),
        new Promise<null>((resolve) => { timer = setTimeout(resolve, 1000, null) }),
      ])
    }
    finally {
      clearTimeout(timer)
    }
  }
}
