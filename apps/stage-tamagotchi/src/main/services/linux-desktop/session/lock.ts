import type { DbusTransport } from '../dbus/transport'

import { pid } from 'node:process'

const login = 'org.freedesktop.login1'
const loginSession = `${login}.Session`
const screenSaver = 'org.freedesktop.ScreenSaver'
const screenSaverPath = '/org/freedesktop/ScreenSaver'
const properties = 'org.freedesktop.DBus.Properties'
type Source = 'logind' | 'screensaver' | null

export function lockState(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** Buses belong to the bridge; this source owns only its subscriptions. */
export class LockSource {
  private state: boolean | null = null
  private source: Source = null
  private generation = 0
  private revision = 0
  private unsubscribe: (() => void) | undefined
  private readonly watchers: (() => void)[] = []
  private starting: Promise<Source> | undefined

  constructor(private readonly options: {
    readonly systemBus: DbusTransport | null
    readonly sessionBus: DbusTransport
    readonly onLock: (locked: boolean) => void
    readonly onSource?: (source: Source) => void
  }) {}

  start(): Promise<Source> {
    if (this.starting)
      return this.starting
    const { systemBus, sessionBus } = this.options
    this.watchers.push(sessionBus.onNameOwnerChanged(screenSaver, () => this.reconnect()))
    if (systemBus)
      this.watchers.push(systemBus.onNameOwnerChanged(login, () => this.reconnect()))
    this.starting = this.connect(this.generation)
    for (const bus of new Set([sessionBus, systemBus])) {
      if (bus)
        this.watchers.push(bus.onFailure(() => this.reconnect()))
    }
    return this.starting
  }

  stop(): void {
    this.generation++
    this.unsubscribe?.()
    this.unsubscribe = undefined
    for (const unsubscribe of this.watchers)
      unsubscribe()
    this.watchers.length = 0
    this.starting = undefined
    this.verify(null)
  }

  private reconnect(): void {
    if (!this.starting)
      return
    ++this.generation
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.verify(null)
    this.starting = this.connect(this.generation)
  }

  private async connect(generation: number): Promise<Source> {
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
            if (this.source === 'logind')
              this.update(state)
            else
              void this.refresh(read, generation, 'logind')
          }
        }
        else if (Array.isArray(invalidated) && invalidated.includes('LockedHint')) {
          void this.refresh(read, generation, 'logind')
        }
      })
      const state = await this.refresh(read, generation, 'logind')
      if (generation !== this.generation)
        return null
      if (state !== null)
        return 'logind'
      this.unsubscribe()
      this.unsubscribe = undefined
    }

    if (await this.read(() => sessionBus.getNameOwner(screenSaver)) === null || generation !== this.generation)
      return null
    const read = () => sessionBus.call<unknown>({
      destination: screenSaver,
      path: screenSaverPath,
      interface: screenSaver,
      member: 'GetActive',
    })
    this.unsubscribe = sessionBus.onSignal({ sender: screenSaver, path: screenSaverPath, interface: screenSaver, member: 'ActiveChanged' }, ([value]) => {
      // An in-flight initial snapshot must not overwrite a newer push.
      this.revision++
      const state = lockState(value)
      if (generation !== this.generation || state === null)
        return
      if (this.source === 'screensaver')
        this.update(state)
      else
        void this.refresh(read, generation, 'screensaver')
    })
    const state = await this.refresh(read, generation, 'screensaver')
    if (generation !== this.generation)
      return null
    if (state !== null)
      return 'screensaver'
    this.unsubscribe?.()
    this.unsubscribe = undefined
    return null
  }

  private async refresh(read: () => Promise<unknown>, generation: number, source: Exclude<Source, null>): Promise<boolean | null> {
    const revision = ++this.revision
    const state = lockState(await this.read(read))
    if (generation === this.generation && revision === this.revision) {
      this.verify(state === null ? null : source)
      this.update(state)
    }
    return state
  }

  private verify(source: Source): void {
    if (source === null)
      this.state = null
    if (source === this.source)
      return
    this.source = source
    this.options.onSource?.(source)
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
          if (error instanceof Error)
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
