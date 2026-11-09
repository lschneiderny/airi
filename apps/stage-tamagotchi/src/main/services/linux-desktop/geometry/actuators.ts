export interface KeepAboveEntry {
  readonly id: string
  /** Absent on backends that cannot read keep-above back; such a request never verifies. */
  readonly keepAbove?: boolean
}

const keepAboveTimeoutMs = 1000

/**
 * Turns compositor read-back into the keep-above fact.
 *
 * Only the latest request per window counts. A request verifies when a push
 * shows its value; it reports a mismatch when no push shows it within one
 * second after the actuator ran, or when the actuator failed. A window that
 * disappears from the push before a verdict gives none.
 */
export class KeepAboveVerifier {
  private readonly pending = new Map<string, { on: boolean, timer?: ReturnType<typeof setTimeout> }>()

  constructor(private readonly options: { report: (verified: boolean) => void }) {}

  expect(id: string, on: boolean) {
    this.forget(id)
    this.pending.set(id, { on })
  }

  applied(id: string, on: boolean, current: readonly KeepAboveEntry[] | null) {
    const request = this.pending.get(id)
    if (!request || request.on !== on || request.timer)
      return
    if (this.settle(id, current))
      return
    request.timer = setTimeout(() => {
      this.pending.delete(id)
      this.options.report(false)
    }, keepAboveTimeoutMs)
  }

  failed(id: string, on: boolean) {
    if (this.pending.get(id)?.on !== on)
      return
    this.forget(id)
    this.options.report(false)
  }

  observe(windows: readonly KeepAboveEntry[] | null) {
    for (const id of [...this.pending.keys()])
      this.settle(id, windows)
  }

  forget(id: string) {
    clearTimeout(this.pending.get(id)?.timer)
    this.pending.delete(id)
  }

  reset() {
    for (const id of [...this.pending.keys()])
      this.forget(id)
  }

  private settle(id: string, windows: readonly KeepAboveEntry[] | null): boolean {
    const request = this.pending.get(id)
    if (!request || !windows)
      return false
    const entry = windows.find(candidate => candidate.id === id)
    if (!entry) {
      this.forget(id)
      return true
    }
    if (entry.keepAbove !== request.on)
      return false
    this.forget(id)
    this.options.report(true)
    return true
  }
}

/**
 * Runs one actuator at a time per key. Values submitted while one runs
 * replace each other, so a burst applies its first and its last value only.
 */
export class LatestValueActuator<K, V> {
  private readonly pending = new Map<K, V>()
  private readonly running = new Set<K>()

  constructor(private readonly options: { apply: (key: K, value: V) => Promise<void>, onError: (error: unknown) => void }) {}

  submit(key: K, value: V) {
    this.pending.set(key, value)
    if (!this.running.has(key))
      void this.drain(key)
  }

  cancel(key: K) {
    this.pending.delete(key)
  }

  private async drain(key: K) {
    this.running.add(key)
    try {
      while (this.pending.has(key)) {
        const value = this.pending.get(key) as V
        this.pending.delete(key)
        try {
          await this.options.apply(key, value)
        }
        catch (error) {
          this.options.onError(error)
        }
      }
    }
    finally {
      this.running.delete(key)
    }
  }
}
