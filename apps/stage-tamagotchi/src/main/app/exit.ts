export type AppExitOutcome = 'clean' | 'failed' | 'timed-out'

export interface AppExitOptions {
  /** Every shutdown step; resolves `false` when a step failed. */
  shutdown: () => Promise<boolean>
  /** Ends the process. Called once, when `shutdown` settles or `timeoutMs` passes, whichever comes first. */
  finish: (outcome: AppExitOutcome) => void
  timeoutMs: number
  setTimeout: (callback: () => void, ms: number) => () => void
}

/**
 * Runs the app's shutdown once and holds every quit request until it has finished.
 *
 * A quit can be requested several times while the shutdown runs: SIGINT, CDP `Browser.close` (how QA tools close the
 * app), SIGTERM, `window-all-closed`, or the tray. Electron does not quit on SIGTERM once a Node listener exists (srvx and
 * `index.ts` add one), so AppExit handles SIGINT and SIGTERM itself. Electron ends the process as soon as
 * one `before-quit` is not prevented, which drops async shutdown work such as the perf recorder's last append. Only the
 * quit that `finish` issues may proceed; the timeout keeps a hung step from blocking the quit for good.
 */
export class AppExit {
  #state: 'running' | 'exiting' | 'finished' = 'running'
  #cancelTimeout = () => {}

  constructor(private readonly options: AppExitOptions) {}

  get exiting(): boolean {
    return this.#state !== 'running'
  }

  /** Starts the shutdown; later calls do nothing. */
  request(): void {
    if (this.#state !== 'running')
      return
    this.#state = 'exiting'
    this.#cancelTimeout = this.options.setTimeout(() => this.#finish('timed-out'), this.options.timeoutMs)
    this.options.shutdown().then(
      clean => this.#finish(clean ? 'clean' : 'failed'),
      () => this.#finish('failed'),
    )
  }

  /** Answers Electron's `before-quit`: returns whether this quit may proceed, and starts the shutdown when it may not. */
  beforeQuit(): boolean {
    if (this.#state === 'finished')
      return true
    this.request()
    return false
  }

  #finish(outcome: AppExitOutcome): void {
    if (this.#state === 'finished')
      return
    this.#state = 'finished'
    this.#cancelTimeout()
    this.options.finish(outcome)
  }
}
