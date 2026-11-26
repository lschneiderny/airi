import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { ForegroundWindowSample } from '@proj-airi/electron-eventa'
import type { BrowserWindow } from 'electron'

import type { PresenceFrontApp, PresenceHide, PresenceHideScope, PresenceHidesState } from '../../../shared/eventa'

import process from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'
import { isBlockedApp, labelFromExe } from '@proj-airi/stage-shared/situation'

import { presenceHidesAdd, presenceHidesChanged, presenceHidesGet, presenceHidesRemove, presenceInstalledAppsList } from '../../../shared/eventa'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { onWindowClosed } from '../../libs/electron/on-window-closed'
import { installedAppName, listInstalledApps } from './installed-apps'

/** What a foreground read knows about the app in front. Only `sample` ever crosses IPC. */
export interface PresenceReading {
  sample: ForegroundWindowSample
  /** Every name the block list may match for the app. */
  appNames: readonly (string | null)[]
  /** The one name a block-list entry or an app hide uses for the app, or `null` when the host read none. */
  appKey: string | null
}

interface HideRecord extends PresenceHide {
  windowId: string | null
  pid: number | null
  appKey: string | null
}

interface FrontTarget extends PresenceFrontApp {
  windowId: string | null
  pid: number
  appNames: readonly (string | null)[]
}

type ChangeListener = (state: PresenceHidesState, hidesChanged: boolean) => void

/** Whether a process still runs. `EPERM` means it runs under another user. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Temporary presence hides: windows, apps, or everything that the user hid from the character for a while.
 *
 * Use when:
 * - The foreground service decides whether a reading may cross IPC, next to the persisted block list
 * - The tray or a settings window hides the app the user last had in front
 *
 * Expects:
 * - The foreground service calls {@link PresenceHides.observe} with every reading of a foreign app, hidden or not
 *
 * Returns:
 * - Hides held only in memory, so every hide ends when AIRI quits. A timed hide ends at its time, and a window hide
 *   also ends once its app's process exits. Listeners hear every change of the hides and of the front app.
 */
export class PresenceHides {
  private hides: HideRecord[] = []
  private front: FrontTarget | null = null
  private nextId = 1
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly listeners = new Set<ChangeListener>()

  constructor(private readonly options: {
    now?: () => number
    isAlive?: (pid: number) => boolean
    labelFor?: (appKey: string) => string
    platform?: string
  } = {}) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  private platform() {
    return this.options.platform ?? process.platform
  }

  /** Whether a temporary hide covers this reading. AIRI's own windows are never hidden. */
  isHidden(reading: PresenceReading): boolean {
    if (reading.sample.ownProcess)
      return false
    return this.hides.some((hide) => {
      if (hide.scope === 'window')
        return hide.windowId !== null && hide.windowId === reading.sample.windowId
      if (hide.scope === 'app')
        return hide.appKey !== null && isBlockedApp(reading.appNames, [hide.appKey], this.platform())
      return true
    })
  }

  /**
   * Remembers a foreign reading as the front app. A reading that is hidden by the block list, a private window, or
   * a hide clears the front app instead, so a hidden app's name never reaches a renderer through it. A read of
   * AIRI's own window keeps the front app unless `blockedApps` now covers it, as after Block always in Settings.
   */
  observe(reading: PresenceReading, hidden: boolean, blockedApps: readonly string[]) {
    if (reading.sample.ownProcess) {
      if (this.front && isBlockedApp(this.front.appNames, blockedApps, this.platform())) {
        this.front = null
        this.emit(false)
      }
      return
    }
    const pruned = this.prune()
    const next = hidden || !reading.appKey ? null : this.targetOf(reading, reading.appKey)
    const frontChanged = !sameTarget(this.front, next)
    this.front = next
    if (pruned || frontChanged)
      this.emit(pruned)
  }

  private targetOf(reading: PresenceReading, appKey: string): FrontTarget {
    return {
      label: this.options.labelFor?.(appKey) ?? appKey,
      appKey,
      canHideWindow: reading.sample.windowId !== null,
      windowId: reading.sample.windowId,
      pid: reading.sample.pid,
      appNames: reading.appNames,
    }
  }

  /**
   * Hides the front app's window or app, or everything. A `window` or `app` hide without a front app changes nothing.
   * A new hide replaces one of the same scope and target, so a second pause restarts the pause instead of adding one.
   */
  add(scope: PresenceHideScope, durationMs: number | null): PresenceHidesState {
    const front = this.front
    if (scope !== 'all' && !front)
      return this.state()
    if (scope === 'window' && !front?.windowId)
      return this.state()

    const record: HideRecord = {
      id: String(this.nextId++),
      scope,
      label: scope === 'all' ? null : front!.label,
      untilMs: scope === 'window' || durationMs === null ? null : this.now() + durationMs,
      windowId: scope === 'window' ? front!.windowId : null,
      pid: scope === 'window' ? front!.pid : null,
      appKey: scope === 'app' ? front!.appKey : null,
    }
    this.hides = this.hides.filter(hide => hide.scope !== scope || hide.windowId !== record.windowId || hide.appKey !== record.appKey)
    this.hides.push(record)
    // What was in front is hidden now, so it must not stay on offer under its name.
    this.front = null
    this.schedule()
    this.emit(true)
    return this.state()
  }

  remove(id: string): PresenceHidesState {
    const before = this.hides.length
    this.hides = this.hides.filter(hide => hide.id !== id)
    if (this.hides.length !== before) {
      this.schedule()
      this.emit(true)
    }
    return this.state()
  }

  state(): PresenceHidesState {
    if (this.prune())
      this.emit(true)
    return this.snapshot()
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose() {
    clearTimeout(this.timer)
    this.listeners.clear()
  }

  private snapshot(): PresenceHidesState {
    return {
      hides: this.hides.map(({ id, scope, label, untilMs }) => ({ id, scope, label, untilMs })),
      front: this.front && { label: this.front.label, appKey: this.front.appKey, canHideWindow: this.front.canHideWindow },
    }
  }

  /** Drops expired hides and window hides whose app quit. Reports whether any ended. */
  private prune(): boolean {
    const now = this.now()
    const isAlive = this.options.isAlive ?? processAlive
    const kept = this.hides.filter(hide => (hide.untilMs === null || hide.untilMs > now) && (hide.pid === null || isAlive(hide.pid)))
    if (kept.length === this.hides.length)
      return false
    this.hides = kept
    this.schedule()
    return true
  }

  private schedule() {
    clearTimeout(this.timer)
    this.timer = undefined
    const next = Math.min(...this.hides.map(hide => hide.untilMs ?? Infinity))
    if (!Number.isFinite(next))
      return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.prune())
        this.emit(true)
    }, Math.max(0, next - this.now()))
  }

  private emit(hidesChanged: boolean) {
    const state = this.snapshot()
    for (const listener of this.listeners)
      listener(state, hidesChanged)
  }
}

function sameTarget(left: FrontTarget | null, right: FrontTarget | null): boolean {
  return left === right || (left !== null && right !== null && left.appKey === right.appKey && left.label === right.label
    && left.windowId === right.windowId && left.pid === right.pid)
}

/** The app-wide hides; every window's foreground service and the tray share them. */
export const presenceHides = new PresenceHides({
  labelFor: appKey => installedAppName(appKey) ?? labelFromExe(appKey, process.platform),
})
onAppBeforeQuit(() => presenceHides.dispose())

/**
 * Serves the presence hides and the installed-app list to one window's renderer, and pushes every change to it.
 */
export function createPresenceHidesService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  const offs = [
    defineInvokeHandler(params.context, presenceHidesGet, () => presenceHides.state()),
    defineInvokeHandler(params.context, presenceHidesAdd, ({ scope, durationMs }) => presenceHides.add(scope, durationMs)),
    defineInvokeHandler(params.context, presenceHidesRemove, ({ id }) => presenceHides.remove(id)),
    defineInvokeHandler(params.context, presenceInstalledAppsList, () => listInstalledApps()),
    presenceHides.onChange((state, hidesChanged) => params.context.emit(presenceHidesChanged, { ...state, hidesChanged })),
  ]
  function dispose() {
    for (const off of offs.splice(0))
      off()
  }
  const offBeforeQuit = onAppBeforeQuit(dispose)
  onWindowClosed(params.window, () => {
    dispose()
    offBeforeQuit()
  })
}
