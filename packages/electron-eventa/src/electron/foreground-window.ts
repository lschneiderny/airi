import { defineInvokeEventa } from '@moeru/eventa'

/**
 * Windows shell notification state (`SHQueryUserNotificationState`, QUNS values 1..7 in order).
 * `busy`, `d3d-fullscreen`, and `presentation` mean a fullscreen app or a presentation is in front.
 * `quiet-time` is the first hour after the user's first sign-in following a Windows install or upgrade.
 * `app` means a Windows Store app is in front.
 */
export type ForegroundNotificationState = 'not-present' | 'busy' | 'd3d-fullscreen' | 'presentation' | 'accepts' | 'quiet-time' | 'app'

/**
 * One reading of the desktop window that has keyboard focus.
 *
 * The title is raw (up to the main process read cap). Consumers own normalization
 * and the title denylist before a title reaches a prompt, and must not persist it.
 */
export interface ForegroundWindowSample {
  /** Full image path of the owning process, or `null` when Windows denies the query. */
  exePath: string | null
  /** File name of `exePath` with its original casing, for example `Notepad.exe`. */
  exeName: string | null
  /** Window title; empty when the window has none. */
  title: string
  pid: number
  /** `true` when the window belongs to one of AIRI's own Electron processes. */
  ownProcess: boolean
  /** `null` when the shell query fails. */
  notificationState: ForegroundNotificationState | null
  /** Main process `Date.now()` at the time of the reading. */
  sampledAtMs: number
}

/**
 * Reads the foreground window once. The main process never samples on its own; the caller sets the rate.
 * Resolves `null` when no window has focus (lock screen, desktop switch), the window closed during the read,
 * or the host cannot sample (not Windows, or the FFI binding failed to load).
 */
const sample = defineInvokeEventa<ForegroundWindowSample | null>('eventa:invoke:electron:foreground-window:sample')

export const foregroundWindow = {
  sample,
}
