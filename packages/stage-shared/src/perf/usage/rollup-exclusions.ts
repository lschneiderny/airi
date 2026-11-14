import type { UsageEventRecord } from './records'

/** Windows overlapping the first 60 s after the segment's `session-start` are excluded. */
export const ROLLUP_SESSION_SETTLING_MS = 60_000
/** Windows overlapping 20 s from a model load, resume, renderer reload, or new identity epoch are excluded. */
export const ROLLUP_EVENT_SETTLING_MS = 20_000

/**
 * The time ranges of one segment that exclude stage windows from its cells. A window covers `(startMs, endMs]`
 * and is excluded when it overlaps the first 60 s after `session-start`, 20 s from a model load, resume, renderer
 * reload, or new identity epoch, or a suspend..resume gap. A suspend with no later resume runs to the end.
 */
export class RollupExclusions {
  readonly #settlingFromMs: number[] = []
  readonly #suspendsMs: number[] = []
  readonly #resumesMs: number[] = []

  addEvent(record: UsageEventRecord): void {
    switch (record.name) {
      case 'model-load':
      case 'renderer-reload':
        this.#settlingFromMs.push(record.t)
        break
      case 'resume':
        this.#settlingFromMs.push(record.t)
        this.#resumesMs.push(record.t)
        break
      case 'suspend':
        this.#suspendsMs.push(record.t)
        break
      case 'feature-change':
      case 'visibility':
      case 'recording-start':
      case 'recording-stop':
      case 'trace-start':
      case 'trace-stop':
      case 'rollup-missing':
      case 'incident-suppressed':
        break
      default: {
        const unhandled: never = record.name
        return unhandled
      }
    }
  }

  addIdentityChange(atMs: number): void {
    this.#settlingFromMs.push(atMs)
  }

  excludes(window: { readonly startMs: number, readonly endMs: number }, sessionStartedAt: number): boolean {
    const { startMs, endMs } = window
    if (startMs < sessionStartedAt + ROLLUP_SESSION_SETTLING_MS)
      return true
    const overlaps = (fromMs: number, toMs: number) => endMs >= fromMs && startMs < toMs
    if (this.#settlingFromMs.some(atMs => overlaps(atMs, atMs + ROLLUP_EVENT_SETTLING_MS)))
      return true
    return this.#suspendsMs.some((suspendMs) => {
      const resumeMs = Math.min(...this.#resumesMs.filter(atMs => atMs >= suspendMs))
      return overlaps(suspendMs, resumeMs)
    })
  }
}
