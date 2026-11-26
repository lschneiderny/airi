import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

/**
 * What a presence hide covers: one window, every window of one app, or everything in front (a pause).
 * AIRI's own windows are never hidden.
 */
export type PresenceHideScope = 'window' | 'app' | 'all'

/** A temporary hide, as the main process reports it. Hides live in main-process memory and end when AIRI quits. */
export interface PresenceHide {
  id: string
  scope: PresenceHideScope
  /** The app's display name; `null` for a pause. */
  label: string | null
  /** When the hide ends on its own, as `Date.now()` milliseconds, or `null` when it lasts until AIRI quits. A window hide also ends when its app quits. */
  untilMs: number | null
}

/**
 * The app the user last had in front, other than AIRI. The main process remembers it from the foreground reads, so
 * the tray and the settings window can hide it after AIRI took focus. It is `null` before any read, while the
 * foreground app is not shared, and while the app last in front is already hidden from presence.
 */
export interface PresenceFrontApp {
  label: string
  /** The name a block-list entry uses for this app. */
  appKey: string
  /** Whether the host can tell this app's windows apart, so `window` hides are offered. */
  canHideWindow: boolean
}

export interface PresenceHidesState {
  hides: PresenceHide[]
  front: PresenceFrontApp | null
}

/** An app that the host's app launcher lists, for picking block-list entries. */
export interface InstalledApp {
  name: string
  /** The block-list entry that matches this app. */
  appKey: string
}

export const presenceHidesGet = defineInvokeEventa<PresenceHidesState>('eventa:invoke:presence:hides:get')
/**
 * Hides the front app (scope `window` or `app`) or everything (scope `all`). `durationMs` `null` lasts until AIRI
 * quits; a `window` hide ignores it and ends when its app quits. Resolves the new state; a `window` or `app` hide
 * without a front app changes nothing.
 */
export const presenceHidesAdd = defineInvokeEventa<PresenceHidesState, { scope: PresenceHideScope, durationMs: number | null }>('eventa:invoke:presence:hides:add')
export const presenceHidesRemove = defineInvokeEventa<PresenceHidesState, { id: string }>('eventa:invoke:presence:hides:remove')
/** Sent to every window when the hides or the front app change. `hidesChanged` is false when only the front app changed. */
export const presenceHidesChanged = defineEventa<PresenceHidesState & { hidesChanged: boolean }>('eventa:event:presence:hides:changed')
/** The apps of the host's app launcher, sorted by name. Empty on a host that has no reader for them. */
export const presenceInstalledAppsList = defineInvokeEventa<InstalledApp[]>('eventa:invoke:presence:installed-apps:list')
