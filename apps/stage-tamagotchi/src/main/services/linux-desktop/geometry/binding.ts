export interface BindableWindow {
  getTitle: () => string
  setTitle: (title: string) => void
  isDestroyed: () => boolean
}

export interface OwnWindowEntry {
  readonly id: string
  readonly caption: string
}

export interface OwnWindowSource<E extends OwnWindowEntry> {
  ownWindows: () => readonly E[] | null
  onOwnWindows: (listener: (windows: readonly E[] | null) => void) => () => void
}

interface Handshake {
  readonly promise: Promise<string | null>
  readonly cancel: () => void
}

const bindTimeoutMs = 2000

/**
 * Proves which compositor window belongs to which AIRI window.
 *
 * The compositor reports AIRI's own windows by pid, which cannot tell two AIRI
 * windows apart. A handshake gives the window a unique `airi-bind-<n>` title,
 * waits up to two seconds for an own-window entry with that caption, records
 * the entry id and restores the title. Geometry from a window that never
 * proved its id is never trusted. A binding ends when the compositor stops
 * reporting its id.
 */
export class OwnWindowBinder<W extends BindableWindow, E extends OwnWindowEntry> {
  private readonly bindings = new Map<W, string>()
  private readonly handshakes = new Map<W, Handshake>()
  private counter = 0
  private readonly offSource: () => void

  constructor(private readonly options: { source: OwnWindowSource<E>, onUnbound?: (window: W) => void }) {
    this.offSource = options.source.onOwnWindows(windows => this.prune(windows))
  }

  bind(window: W): Promise<string | null> {
    const running = this.handshakes.get(window)
    if (running)
      return running.promise
    if (window.isDestroyed())
      return Promise.resolve(null)

    const title = `airi-bind-${++this.counter}`
    const previous = window.getTitle()
    const { promise, resolve } = Promise.withResolvers<string | null>()
    let off: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (id: string | null) => {
      clearTimeout(timer)
      off?.()
      this.handshakes.delete(window)
      if (!window.isDestroyed() && window.getTitle() === title)
        window.setTitle(previous)
      resolve(id)
    }
    const match = (windows: readonly E[] | null) => {
      const entry = windows?.find(candidate => candidate.caption === title)
      if (!entry)
        return
      for (const [other, id] of this.bindings) {
        if (id === entry.id)
          this.bindings.delete(other)
      }
      this.bindings.set(window, entry.id)
      finish(entry.id)
    }
    timer = setTimeout(finish, bindTimeoutMs, null)
    this.handshakes.set(window, { promise, cancel: () => finish(null) })
    off = this.options.source.onOwnWindows(match)
    window.setTitle(title)
    match(this.options.source.ownWindows())
    return promise
  }

  entryFor(window: W): E | undefined {
    const id = this.bindings.get(window)
    return id === undefined ? undefined : this.options.source.ownWindows()?.find(entry => entry.id === id)
  }

  unbind(window: W) {
    this.handshakes.get(window)?.cancel()
    this.bindings.delete(window)
  }

  clear() {
    for (const handshake of [...this.handshakes.values()])
      handshake.cancel()
    this.bindings.clear()
  }

  dispose() {
    this.clear()
    this.offSource()
  }

  private prune(windows: readonly E[] | null) {
    for (const [window, id] of [...this.bindings]) {
      if (windows?.some(entry => entry.id === id))
        continue
      this.bindings.delete(window)
      this.options.onUnbound?.(window)
    }
  }
}
