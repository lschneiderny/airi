import type { KwinMessage } from '../kwin/protocol'

import { Buffer } from 'node:buffer'

import { X11BackendError, X11Binding } from './binding'
import { parseUtf8Name, parseWmClass } from './parsers'

export type X11ActiveWindow = Pick<NonNullable<Extract<KwinMessage, { method: 'Active' }>['payload']>, 'caption' | 'resourceClass' | 'pid' | 'fullScreen'>

export interface X11EwmhBackendOptions {
  readonly sessionType: string
  readonly display: string
}

/**
 * On-demand reads only: the EWMH active window and the root pointer. Electron keeps window rectangles and displays.
 * The pointer comes from the server because Electron's X11 cursor is a cache that only events on its own windows
 * refresh, and a click-through window receives none.
 */
export class X11EwmhBackend {
  private binding: X11Binding | undefined
  private starting: Promise<void> | undefined
  private generation = 0

  constructor(private readonly options: X11EwmhBackendOptions) {
    if (options.sessionType !== 'x11')
      throw new X11BackendError('session-unsupported')
  }

  /** Idempotent; failed starts may be retried explicitly by the bridge. */
  start(): Promise<void> {
    if (this.starting)
      return this.starting
    if (this.binding)
      return Promise.resolve()
    const generation = ++this.generation
    this.starting = X11Binding.open(this.options.display).then((binding) => {
      if (generation === this.generation)
        this.binding = binding
      else
        binding.close()
    }).finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  /** Also waits for and closes a connection whose start is still in flight. */
  async stop(): Promise<void> {
    ++this.generation
    this.binding?.close()
    this.binding = undefined
    await this.starting
  }

  /** The root pointer in X11 pixels, or `null` before the display opened or while the pointer is on another screen. */
  pointer(): { x: number, y: number } | null {
    return this.binding?.pointer() ?? null
  }

  activeWindow(): X11ActiveWindow | null {
    const binding = this.binding
    if (!binding)
      return null
    try {
      const active = binding.property(binding.root, '_NET_ACTIVE_WINDOW', 'WINDOW')
      if (active?.format !== 32 || active.data.length !== 1 || !active.data[0])
        return null
      const window = active.data[0]
      const name = binding.property(window, '_NET_WM_NAME', 'UTF8_STRING')
      let caption: string | null
      if (name === null) {
        const legacy = binding.property(window, 'WM_NAME', 'STRING')
        // ICCCM STRING is Latin-1. COMPOUND_TEXT is not claimed as supported.
        caption = legacy?.format === 8 ? Buffer.from(legacy.data).toString('latin1').replace(/\0$/u, '') : ''
        if (caption.includes('\0'))
          return null
      }
      else {
        caption = name.format === 8 ? parseUtf8Name(name.data) : null
      }
      const wmClass = binding.property(window, 'WM_CLASS', 'STRING')
      const resourceClass = wmClass?.format === 8 ? parseWmClass(wmClass.data) : null
      const process = binding.property(window, '_NET_WM_PID', 'CARDINAL')
      const pid = process?.format === 32 && process.data.length === 1 ? process.data[0] : undefined
      const state = binding.property(window, '_NET_WM_STATE', 'ATOM')
      if (caption === null || resourceClass === null || pid === undefined || pid === 0 || (state !== null && state.format !== 32))
        return null
      const fullScreen = state?.format === 32 && state.data.includes(binding.atom('_NET_WM_STATE_FULLSCREEN'))
      return { caption, resourceClass, pid, fullScreen }
    }
    catch (error) {
      if (error instanceof X11BackendError && error.reason === 'property-invalid')
        return null
      throw error
    }
  }
}
