import type { DbusTransport } from '../dbus/transport'

const notifications = 'org.freedesktop.Notifications'
const notificationsPath = '/org/freedesktop/Notifications'
const gameMode = 'com.feralinteractive.GameMode'
const gameModePath = '/com/feralinteractive/GameMode'
const properties = 'org.freedesktop.DBus.Properties'

export function busyHint(clientCount: unknown, inhibited: unknown): 'busy' | 'quiet' | null {
  if (typeof clientCount === 'number' && Number.isSafeInteger(clientCount) && clientCount > 0)
    return 'busy'
  return inhibited === true ? 'quiet' : null
}

/** Optional desktop hints; missing or malformed service values mean absent. */
export class BusySource {
  private count: unknown
  private inhibited: unknown
  private generation = 0
  private countRevision = 0
  private inhibitedRevision = 0
  private readonly unsubscribers: (() => void)[] = []
  private starting: Promise<void> | undefined

  constructor(private readonly options: {
    readonly sessionBus: DbusTransport
    readonly onHint?: (hint: 'busy' | 'quiet' | null) => void
  }) {}

  hint(): 'busy' | 'quiet' | null {
    return busyHint(this.count, this.inhibited)
  }

  start(): Promise<void> {
    this.starting ??= this.connect(this.generation)
    return this.starting
  }

  stop(): void {
    this.generation++
    for (const unsubscribe of this.unsubscribers)
      unsubscribe()
    this.unsubscribers.length = 0
    this.starting = undefined
    this.count = undefined
    this.inhibited = undefined
  }

  private async connect(generation: number): Promise<void> {
    const bus = this.options.sessionBus
    this.unsubscribers.push(
      bus.onSignal({ sender: notifications, path: notificationsPath, interface: properties, member: 'PropertiesChanged' }, ([iface]) => {
        if (iface === notifications)
          void this.refreshInhibited(generation)
      }),
      ...['GameRegistered', 'GameUnregistered'].map(member => bus.onSignal({
        sender: gameMode,
        path: gameModePath,
        interface: gameMode,
        member,
      }, () => { void this.refreshCount(generation) })),
      bus.onNameOwnerChanged(gameMode, (_, owner) => {
        if (owner || generation !== this.generation)
          return
        this.countRevision++
        const previous = this.hint()
        this.count = undefined
        if (previous !== this.hint())
          this.options.onHint?.(this.hint())
      }),
      bus.onNameOwnerChanged(notifications, (_, owner) => {
        if (owner || generation !== this.generation)
          return
        this.inhibitedRevision++
        const previous = this.hint()
        this.inhibited = undefined
        if (previous !== this.hint())
          this.options.onHint?.(this.hint())
      }),
    )
    // Establish both initial values together, so startup has no transient hint.
    const countRevision = ++this.countRevision
    const inhibitedRevision = ++this.inhibitedRevision
    const [count, inhibited] = await Promise.all([
      this.readProperty(gameMode, gameModePath, 'ClientCount'),
      this.readProperty(notifications, notificationsPath, 'Inhibited'),
    ])
    if (generation !== this.generation)
      return
    if (countRevision === this.countRevision)
      this.count = count
    if (inhibitedRevision === this.inhibitedRevision)
      this.inhibited = inhibited
  }

  private async refreshCount(generation: number): Promise<void> {
    const revision = ++this.countRevision
    const count = await this.readProperty(gameMode, gameModePath, 'ClientCount')
    if (generation !== this.generation || revision !== this.countRevision)
      return
    const previous = this.hint()
    this.count = count
    if (previous !== this.hint())
      this.options.onHint?.(this.hint())
  }

  private async refreshInhibited(generation: number): Promise<void> {
    const revision = ++this.inhibitedRevision
    const inhibited = await this.readProperty(notifications, notificationsPath, 'Inhibited')
    if (generation !== this.generation || revision !== this.inhibitedRevision)
      return
    const previous = this.hint()
    this.inhibited = inhibited
    if (previous !== this.hint())
      this.options.onHint?.(this.hint())
  }

  private async readProperty(destination: string, path: string, name: string): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        (async () => {
          const bus = this.options.sessionBus
          // Probe ownership first: optional hints must not activate a desktop service.
          if (await bus.getNameOwner(destination) === null)
            return null
          return bus.getProperty<unknown>(destination, path, destination, name)
        })().catch((error: unknown) => {
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
