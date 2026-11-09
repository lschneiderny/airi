import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { ShortcutBinding, ShortcutRegistrationResult } from '@proj-airi/stage-shared/global-shortcut'
import type { BrowserWindow } from 'electron'

import type { DbusTransport } from '../linux-desktop/dbus/transport'
import type { PortalShortcutsDriver } from '../linux-desktop/session/global-shortcuts-portal'
import type { UiohookDriver } from './global-shortcut-uiohook'

import process from 'node:process'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { formatElectronAccelerator, isSameKeyCombination, ShortcutFailureReasons } from '@proj-airi/stage-shared/global-shortcut'
import { globalShortcut } from 'electron'

import {
  electronShortcutList,
  electronShortcutRegister,
  electronShortcutTriggered,
  electronShortcutUnregister,
  electronShortcutUnregisterAll,
} from '../../../shared/eventa'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { getCurrentHostCapabilities, reportGlobalInputHookFailure, reportLinuxDesktop } from './host-capabilities'

export type EventaContext = ReturnType<typeof createContext>['context']

export interface RegisterWindowParams {
  context: EventaContext
  window: BrowserWindow
}

export interface RegisterMainShortcutParams {
  binding: ShortcutBinding
  onTriggered: () => void
}

export interface GlobalShortcutService {
  registerWindow: (params: RegisterWindowParams) => void
  registerMainShortcut: (params: RegisterMainShortcutParams) => ShortcutRegistrationResult
  dispose: () => Promise<void>
}

export interface GlobalShortcutServiceOptions {
  /**
   * The GlobalShortcuts portal for key-up bindings on Linux. The Linux desktop bridge opens its bus from
   * the injected environment. Without it, every key-up binding uses the uiohook driver.
   */
  portal?: {
    /** Opens a connection that the service owns and closes on dispose. */
    openBus: () => Promise<DbusTransport>
    /** Bound on each portal request, including a BindShortcuts dialog. Defaults to the driver's 60 s. */
    requestTimeoutMs?: number
  }
}

type ActiveBinding
  = | { binding: ShortcutBinding, owner: 'renderer', driver: 'electron', electronAccelerator: string }
    | { binding: ShortcutBinding, owner: 'main', driver: 'electron', electronAccelerator: string, onTriggered: () => void }
    | { binding: ShortcutBinding, owner: 'renderer', driver: 'uiohook' }
    | { binding: ShortcutBinding, owner: 'renderer', driver: 'portal' }

export function setupGlobalShortcutService(options: GlobalShortcutServiceOptions = {}): GlobalShortcutService {
  const log = useLogg('global-shortcut').useGlobalConfig()

  const contexts = new Set<EventaContext>()
  const active = new Map<string, ActiveBinding>()

  function broadcastTriggered(id: string, phase: 'down' | 'up') {
    for (const context of contexts) {
      try {
        context.emit(electronShortcutTriggered, { id, phase })
      }
      catch (error) {
        log.withError(error).warn(`Failed to emit shortcut trigger for "${id}"`)
      }
    }
  }

  let uiohookDriver: UiohookDriver | undefined

  /**
   * Tells if another binding already uses the key combination of `binding`.
   *
   * Electron `globalShortcut` rejects a second registration of one accelerator, but the uiohook driver does not
   * register with the OS and does not consume key events. So a uiohook binding and an Electron binding with one
   * combination would both fire on one press. This check covers both drivers. A binding with the same ID is the
   * binding that a caller rebinds, so it is not a conflict.
   */
  function usedByAnotherBinding(binding: ShortcutBinding): boolean {
    for (const [id, entry] of active) {
      if (id !== binding.id && isSameKeyCombination(entry.binding.accelerator, binding.accelerator, { isMacOS: process.platform === 'darwin' }))
        return true
    }
    return false
  }

  function tryRegisterElectron(binding: ShortcutBinding): ShortcutRegistrationResult {
    const electronAccelerator = formatElectronAccelerator(binding.accelerator)
    const ok = globalShortcut.register(electronAccelerator, () => broadcastTriggered(binding.id, 'down'))

    if (!ok) {
      // `globalShortcut.register` returns false for several distinct
      // causes (held by another app, or denied by the OS for media
      // keys / Accessibility-gated combos on macOS). Electron does not
      // expose which case applied, so this driver reports `Conflict`
      // for both. The uiohook driver path can emit `Denied` directly.
      return { id: binding.id, ok: false, reason: ShortcutFailureReasons.Conflict }
    }

    active.set(binding.id, { binding, owner: 'renderer', driver: 'electron', electronAccelerator })
    return { id: binding.id, ok: true }
  }

  // The portal binds the whole key-up set at once, and each bind replaces its session, so portal
  // changes run one at a time. Portal entries in `active` are the bindings the portal holds.
  let portal: Promise<{ driver: PortalShortcutsDriver, close: () => Promise<void> } | undefined> | undefined
  let portalQueue: Promise<unknown> = Promise.resolve()
  let portalBusy = false
  let disposed = false

  function portalBindings(): ShortcutBinding[] {
    return Array.from(active.values()).filter(entry => entry.driver === 'portal').map(entry => entry.binding)
  }

  // Session Closed, owner loss, denial and ShortcutsChanged drop portal shortcuts outside a bind.
  function prunePortal(driver: PortalShortcutsDriver): void {
    const held = new Set(driver.list().map(entry => entry.binding.id))
    for (const [id, entry] of active) {
      if (entry.driver === 'portal' && !held.has(id))
        active.delete(id)
    }
  }

  function openPortal(config: NonNullable<GlobalShortcutServiceOptions['portal']>) {
    portal ??= (async () => {
      const { PortalShortcutsDriver } = await import('../linux-desktop/session/global-shortcuts-portal')
      const bus = await config.openBus()
      const driver: PortalShortcutsDriver = new PortalShortcutsDriver({
        sessionBus: bus,
        onTriggered: broadcastTriggered,
        onState: (portalShortcuts) => {
          reportLinuxDesktop({ portalShortcuts })
          if (!portalBusy)
            prunePortal(driver)
        },
        onError: error => log.withError(error).warn('GlobalShortcuts portal request failed'),
        requestTimeoutMs: config.requestTimeoutMs,
      })
      return {
        driver,
        close: async () => {
          await driver.stop()
          await bus.close()
        },
      }
    })().catch((error) => {
      portal = undefined
      log.withError(error).warn('GlobalShortcuts portal is unavailable')
      return undefined
    })
    return portal
  }

  function runPortal<T>(job: (driver: PortalShortcutsDriver) => Promise<T>, unavailable: T): Promise<T> {
    const run = portalQueue.then(async () => {
      const opened = disposed || !options.portal ? undefined : await openPortal(options.portal)
      if (!opened)
        return unavailable
      portalBusy = true
      try {
        return await job(opened.driver)
      }
      finally {
        portalBusy = false
        prunePortal(opened.driver)
      }
    })
    portalQueue = run.catch(() => {})
    return run
  }

  function tryRegisterPortal(binding: ShortcutBinding): Promise<ShortcutRegistrationResult> {
    const unsupported: ShortcutRegistrationResult = { id: binding.id, ok: false, reason: ShortcutFailureReasons.Unsupported }
    return runPortal(async (driver) => {
      // A registration queued earlier can have taken this id or key combination.
      if (active.has(binding.id))
        return { id: binding.id, ok: false, reason: ShortcutFailureReasons.DuplicateId }
      if (usedByAnotherBinding(binding))
        return { id: binding.id, ok: false, reason: ShortcutFailureReasons.Conflict }

      const results = await driver.bind([...portalBindings(), binding])
      const result = results.find(entry => entry.id === binding.id) ?? unsupported
      if (result.ok)
        active.set(binding.id, { binding, owner: 'renderer', driver: 'portal' })
      return result
    }, unsupported)
  }

  /** Rebinds the remaining portal set after a release, unless the portal already holds exactly that set. */
  function syncPortal(): void {
    if (disposed)
      return
    void runPortal(async (driver) => {
      const wanted = portalBindings()
      const held = driver.list()
      if (held.length === wanted.length && held.every(entry => active.get(entry.binding.id)?.driver === 'portal'))
        return
      await driver.bind(wanted)
    }, undefined)
  }

  async function tryRegisterUiohook(binding: ShortcutBinding, fallback?: (binding: ShortcutBinding) => Promise<ShortcutRegistrationResult>): Promise<ShortcutRegistrationResult> {
    if (!uiohookDriver) {
      // NOTICE:
      // uiohook-napi@1.5.5 ships an x86-64 binary in its Linux ARM64 prebuild.
      // Loading the existing driver only when needed keeps AIRI startup working.
      // Source: https://app.unpkg.com/uiohook-napi@1.5.5/files/prebuilds/linux-arm64
      // Remove this workaround when that prebuild contains an ARM64 binary.
      try {
        const { createUiohookDriver } = await import('./global-shortcut-uiohook')
        uiohookDriver = createUiohookDriver({ broadcastTriggered, logger: log })
      }
      catch (error) {
        reportGlobalInputHookFailure('load')
        log.withError(error).warn('uiohook driver is unavailable on this system')
        return fallback?.(binding) ?? { id: binding.id, ok: false, reason: ShortcutFailureReasons.Unsupported }
      }
    }

    const result = uiohookDriver.tryRegister(binding)
    if (result.ok && fallback && !uiohookDriver.isRunning()) {
      uiohookDriver.unregisterById(binding.id)
      return fallback(binding)
    }
    if (result.ok)
      active.set(binding.id, { binding, owner: 'renderer', driver: 'uiohook' })
    return result
  }

  /**
   * Key-up bindings use the GlobalShortcuts portal on Wayland and XWayland, where no global input hook
   * observes other clients. Native X11 keeps uiohook and uses the portal when uiohook fails to load or start.
   * Without a portal, as on Windows and macOS, uiohook takes every key-up binding.
   */
  function tryRegisterKeyUps(binding: ShortcutBinding): Promise<ShortcutRegistrationResult> {
    if (!options.portal)
      return tryRegisterUiohook(binding)
    const { host } = getCurrentHostCapabilities()
    if (host === 'linux-wayland' || host === 'linux-xwayland')
      return tryRegisterPortal(binding)
    return tryRegisterUiohook(binding, host === 'linux-x11' ? tryRegisterPortal : undefined)
  }

  // Main-owned shortcuts stay live without a renderer context.
  function registerMainShortcut({ binding, onTriggered }: RegisterMainShortcutParams): ShortcutRegistrationResult {
    const existing = active.get(binding.id)
    if (existing && existing.owner !== 'main')
      return { id: binding.id, ok: false, reason: ShortcutFailureReasons.DuplicateId }
    if (usedByAnotherBinding(binding))
      return { id: binding.id, ok: false, reason: ShortcutFailureReasons.Conflict }

    const electronAccelerator = formatElectronAccelerator(binding.accelerator)
    const nextEntry: ActiveBinding = { binding, owner: 'main', driver: 'electron', electronAccelerator, onTriggered }
    if (existing?.electronAccelerator === electronAccelerator) {
      releaseEntry(binding.id, existing)
      if (globalShortcut.register(electronAccelerator, onTriggered)) {
        active.set(binding.id, nextEntry)
        return { id: binding.id, ok: true }
      }

      if (globalShortcut.register(existing.electronAccelerator, existing.onTriggered))
        active.set(binding.id, existing)
      else
        log.warn(`Failed to restore main-owned shortcut "${binding.id}" after rebinding failure`)
      return { id: binding.id, ok: false, reason: ShortcutFailureReasons.Conflict }
    }

    if (!globalShortcut.register(electronAccelerator, onTriggered))
      return { id: binding.id, ok: false, reason: ShortcutFailureReasons.Conflict }

    if (existing)
      releaseEntry(binding.id, existing)
    active.set(binding.id, nextEntry)
    return { id: binding.id, ok: true }
  }

  function releaseEntry(id: string, entry: ActiveBinding): void {
    if (entry.driver === 'electron') {
      try {
        globalShortcut.unregister(entry.electronAccelerator)
      }
      catch (error) {
        log.withError(error).warn(`Failed to unregister accelerator for "${id}"`)
      }
    }
    else if (entry.driver === 'uiohook') {
      uiohookDriver?.unregisterById(id)
    }
    active.delete(id)
    if (entry.driver === 'portal')
      syncPortal()
  }

  function tryRegister(binding: ShortcutBinding): ShortcutRegistrationResult | Promise<ShortcutRegistrationResult> {
    if (active.has(binding.id)) {
      return { id: binding.id, ok: false, reason: ShortcutFailureReasons.DuplicateId }
    }
    if (usedByAnotherBinding(binding))
      return { id: binding.id, ok: false, reason: ShortcutFailureReasons.Conflict }

    return binding.receiveKeyUps
      ? tryRegisterKeyUps(binding)
      : tryRegisterElectron(binding)
  }

  function unregisterById(id: string): void {
    const entry = active.get(id)
    if (!entry || entry.owner === 'main')
      return

    releaseEntry(id, entry)
  }

  // Renderer resets must not drop main-owned shortcuts such as Spotlight.
  function unregisterAll(includeMainOwned = false): void {
    for (const [id, entry] of active) {
      if (!includeMainOwned && entry.owner === 'main')
        continue
      releaseEntry(id, entry)
    }
  }

  const registerWindow: GlobalShortcutService['registerWindow'] = ({ context, window }) => {
    contexts.add(context)
    window.on('closed', () => {
      contexts.delete(context)
    })

    defineInvokeHandler(context, electronShortcutRegister, (binding) => {
      if (!binding.id) {
        throw new TypeError('electronShortcutRegister called with invalid binding payload')
      }
      return tryRegister(binding)
    })

    defineInvokeHandler(context, electronShortcutUnregister, (payload) => {
      if (!payload.id)
        return
      unregisterById(payload.id)
    })

    defineInvokeHandler(context, electronShortcutUnregisterAll, () => {
      unregisterAll()
    })

    defineInvokeHandler(context, electronShortcutList, () => {
      return Array.from(active.values(), entry => entry.binding)
    })
  }

  const dispose: GlobalShortcutService['dispose'] = async () => {
    disposed = true
    unregisterAll(true)
    uiohookDriver?.dispose()
    contexts.clear()
    // Stopping the driver cancels a queued bind, so the queue settles before the bus closes.
    const opened = await portal
    await opened?.close()
    await portalQueue
  }

  onAppBeforeQuit(() => dispose())

  return { registerWindow, registerMainShortcut, dispose }
}
