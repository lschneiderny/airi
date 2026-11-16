import { defineInvokeEventa } from '@moeru/eventa'

/**
 * One reading of the desktop window that has keyboard focus.
 *
 * The title is raw (up to the main process read cap). Consumers own normalization
 * before a title reaches a prompt, and must not persist it. The main process never
 * returns a reading of a blocked app or of a private browser window, and returns
 * the title only when the request asks for it.
 */
export interface ForegroundWindowSample {
  /** Full image path of the owning process, or `null` when the host cannot read it. */
  exePath: string | null
  /** File name of `exePath` with its original casing, for example `Notepad.exe` or `TextEdit.app`. */
  exeName: string | null
  /** Window title; empty when the window has none or the request did not set `includeTitle`. */
  title: string
  pid: number
  /** `true` when the window belongs to one of AIRI's own Electron processes. */
  ownProcess: boolean
  /**
   * What the host can say about whether a remark fits now.
   * Each host maps its own OS states before they cross IPC; `null` means this host could not tell.
   */
  busy: 'accepts' | 'busy' | 'fullscreen' | 'presentation' | 'quiet' | null
  /** Main process `Date.now()` at the time of the reading. */
  sampledAtMs: number
}

export interface ForegroundWindowRequest {
  /**
   * App-name globs of the user's block list (the `blockedApps` presence setting). The main process applies them
   * before it replies, so a blocked app's name, title, and pid never cross IPC. AIRI's own windows are exempt.
   */
  blockedApps: readonly string[]
  /**
   * Whether the reply carries the window title (the `shareWindowTitles` presence setting). When false the main
   * process replies with an empty title, so no title crosses IPC.
   */
  includeTitle: boolean
}

/**
 * Reads the foreground window once. The main process never samples on its own; the caller sets the rate.
 * Resolves `null` when no window has focus (lock screen, desktop switch), the window closed during the read,
 * the host cannot sample (no sampler for this host, or its binding failed to load), or the window in front is
 * hidden from presence: its app is on `blockedApps`, or its title marks a private browser window.
 */
const sample = defineInvokeEventa<ForegroundWindowSample | null, ForegroundWindowRequest>('eventa:invoke:electron:foreground-window:sample')

export const foregroundWindow = {
  sample,
}
