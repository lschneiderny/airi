import type { ShortcutBinding } from '@proj-airi/stage-shared/global-shortcut'
import type { HostId, LinuxDesktopFacts } from '@proj-airi/stage-shared/host-capabilities'
import type { BrowserWindow } from 'electron'

import type { EventaContext, GlobalShortcutService, GlobalShortcutServiceOptions } from './global-shortcut'

import { once } from 'node:events'

import { ShortcutFailureReasons } from '@proj-airi/stage-shared/global-shortcut'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sessionInterface } from '../linux-desktop/session/portal-request'
import { FakePortal } from '../linux-desktop/session/portal.test-helper'

function exampleBinding(id: string, key = 'KeyK'): ShortcutBinding {
  return {
    id,
    accelerator: { modifiers: ['cmd-or-ctrl', 'shift'], key },
    scope: 'global',
  }
}

interface MockContext {
  emit: ReturnType<typeof vi.fn>
  invokeHandlers: Map<string, (payload: unknown) => unknown>
}

interface MockWindow {
  on: ReturnType<typeof vi.fn>
  /** Manually trigger the registered `closed` handler. */
  close: () => void
}

function createMockContext(): MockContext {
  return {
    emit: vi.fn(),
    invokeHandlers: new Map(),
  }
}

// NOTICE:
// MockWindow only models what the driver touches: subscribing to a
// `'closed'` event. The mock exposes a manual `close()` so tests can
// assert the auto-cleanup path.
function createMockWindow(): MockWindow {
  let closedHandler: (() => void) | undefined
  return {
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'closed')
        closedHandler = handler
    }),
    close() {
      closedHandler?.()
    },
  }
}

// NOTICE:
// MockContext / MockWindow are intentionally minimal — only what the
// driver touches. Casting through `unknown` lets us pass them to
// `service.registerWindow` whose typed signature wants the full
// `EventaContext` and `BrowserWindow` types.
function asEventaContext(ctx: MockContext): EventaContext {
  return ctx as unknown as EventaContext
}

function asBrowserWindow(window: MockWindow): BrowserWindow {
  return window as unknown as BrowserWindow
}

function registerMockWindow(service: { registerWindow: (params: { context: EventaContext, window: BrowserWindow }) => void }, ctx: MockContext): MockWindow {
  const window = createMockWindow()
  service.registerWindow({
    context: asEventaContext(ctx),
    window: asBrowserWindow(window),
  })
  return window
}

/**
 * Mocks the heavy collaborators (`electron`, eventa, bootkit, logger)
 * so the driver can be exercised through its public interface in a
 * single test file.
 */
async function setupMocks(options: { host?: HostId, uiohook?: 'running' | 'load-fails' | 'start-fails' } = {}) {
  const registerMock = vi.fn<(accelerator: string, callback: () => void) => boolean>(() => true)
  const unregisterMock = vi.fn<(accelerator: string) => void>()
  const unregisterAllMock = vi.fn<() => void>()
  const triggerCallbacks = new Map<string, () => void>()

  registerMock.mockImplementation((accelerator, callback) => {
    triggerCallbacks.set(accelerator, callback)
    return true
  })
  unregisterMock.mockImplementation((accelerator) => {
    triggerCallbacks.delete(accelerator)
  })
  unregisterAllMock.mockImplementation(() => {
    triggerCallbacks.clear()
  })

  const onAppBeforeQuitMock = vi.fn<(fn: () => void | Promise<void>) => void>()

  vi.doMock('electron', () => ({
    globalShortcut: {
      register: registerMock,
      unregister: unregisterMock,
      unregisterAll: unregisterAllMock,
    },
    systemPreferences: {
      isTrustedAccessibilityClient: vi.fn(() => true),
    },
  }))

  const uiohookRegister = vi.fn((binding: ShortcutBinding) => ({ id: binding.id, ok: true }))
  const uiohookUnregister = vi.fn()
  vi.doMock('./global-shortcut-uiohook', () => {
    if (options.uiohook === 'load-fails')
      throw new Error('uiohook-napi has no binary for this system')
    return {
      createUiohookDriver: () => ({
        // The real driver answers at once. An async double would leave the binding out of the active map.
        tryRegister: uiohookRegister,
        unregisterById: uiohookUnregister,
        unregisterAll: vi.fn(),
        isRunning: () => options.uiohook !== 'start-fails',
        dispose: vi.fn(),
      }),
    }
  })

  const states: LinuxDesktopFacts['portalShortcuts'][] = []
  const stateEvents = new EventTarget()
  const getCurrentHostCapabilities = vi.fn(() => ({ host: options.host ?? 'windows' }))
  vi.doMock('./host-capabilities', () => ({
    getCurrentHostCapabilities,
    reportGlobalInputHookFailure: vi.fn(),
    reportLinuxDesktop: (patch: Partial<LinuxDesktopFacts>) => {
      if (patch.portalShortcuts) {
        states.push(patch.portalShortcuts)
        stateEvents.dispatchEvent(new Event(patch.portalShortcuts))
      }
    },
  }))

  vi.doMock('@moeru/eventa', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@moeru/eventa')>()
    return {
      ...actual,
      defineInvokeHandler: (context: MockContext, eventa: { sendEvent: { id: string } }, handler: (payload: unknown) => unknown) => {
        // `defineInvokeEventa('foo')` returns `{ sendEvent: { id: 'foo-send' }, ... }`;
        // strip the `-send` suffix so test lookups match the contract name.
        const id = eventa.sendEvent.id.replace(/-send$/, '')
        context.invokeHandlers.set(id, handler)
      },
    }
  })

  vi.doMock('../../libs/bootkit/lifecycle', () => ({
    onAppBeforeQuit: onAppBeforeQuitMock,
  }))

  vi.doMock('@guiiai/logg', () => ({
    useLogg: () => ({
      useGlobalConfig: () => ({
        warn: vi.fn(),
        withError: vi.fn(() => ({ warn: vi.fn() })),
      }),
    }),
  }))

  const { setupGlobalShortcutService } = await import('./global-shortcut')

  return {
    setupGlobalShortcutService,
    registerMock,
    unregisterMock,
    unregisterAllMock,
    triggerCallbacks,
    onAppBeforeQuitMock,
    uiohookRegister,
    uiohookUnregister,
    getCurrentHostCapabilities,
    states,
    stateEvents,
  }
}

describe('setupGlobalShortcutService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('registers a binding via the invoke handler', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const ctx = createMockContext()
    registerMockWindow(service, ctx)

    const handler = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')
    expect(handler).toBeDefined()

    const result = handler!(exampleBinding('toggle')) as { id: string, ok: boolean }
    expect(result).toEqual({ id: 'toggle', ok: true })
    expect(m.registerMock).toHaveBeenCalledWith('CmdOrCtrl+Shift+K', expect.any(Function))
  })

  it('routes receiveKeyUps:true to the uiohook driver and bypasses electron.globalShortcut', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const ctx = createMockContext()
    registerMockWindow(service, ctx)

    const handler = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    const result = await handler({ ...exampleBinding('ptt'), receiveKeyUps: true }) as { id: string, ok: boolean }
    expect(result).toEqual({ id: 'ptt', ok: true })
    expect(m.registerMock).not.toHaveBeenCalled()
  })

  it('reports conflict when globalShortcut.register returns false', async () => {
    const m = await setupMocks()
    m.registerMock.mockImplementationOnce(() => false)
    const service = m.setupGlobalShortcutService()
    const ctx = createMockContext()
    registerMockWindow(service, ctx)

    const handler = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    const result = handler(exampleBinding('toggle')) as { id: string, ok: boolean, reason?: string }
    expect(result).toEqual({ id: 'toggle', ok: false, reason: ShortcutFailureReasons.Conflict })
  })

  it('rejects duplicate id with reason "duplicate-id" without touching globalShortcut', async () => {
    // Strict registration: the second register call under the same id
    // must fail explicitly so silent overrides between unrelated
    // registration sites cannot happen. Callers rebind by calling
    // `unregister` first.
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const ctx = createMockContext()
    registerMockWindow(service, ctx)

    const handler = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    const first = handler(exampleBinding('toggle', 'KeyK')) as { ok: boolean }
    const second = handler(exampleBinding('toggle', 'KeyZ')) as { id: string, ok: boolean, reason?: string }

    expect(first.ok).toBe(true)
    expect(second).toEqual({ id: 'toggle', ok: false, reason: ShortcutFailureReasons.DuplicateId })
    expect(m.registerMock).toHaveBeenCalledTimes(1)
    expect(m.unregisterMock).not.toHaveBeenCalled()
  })

  it('rebinds main-owned shortcuts transactionally', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    service.registerMainShortcut({
      binding: exampleBinding('spotlight', 'KeyA'),
      onTriggered: vi.fn(),
    })
    const secondTriggered = vi.fn()
    const success = service.registerMainShortcut({
      binding: exampleBinding('spotlight', 'KeyB'),
      onTriggered: secondTriggered,
    })

    expect(success).toEqual({ id: 'spotlight', ok: true })
    expect(m.unregisterMock).toHaveBeenCalledWith('CmdOrCtrl+Shift+A')
    m.triggerCallbacks.get('CmdOrCtrl+Shift+B')?.()
    expect(secondTriggered).toHaveBeenCalledTimes(1)

    const oldTriggered = vi.fn()
    service.registerMainShortcut({ binding: exampleBinding('spotlight', 'KeyA'), onTriggered: oldTriggered })
    m.unregisterMock.mockClear()
    m.registerMock.mockImplementationOnce(() => false)
    const result = service.registerMainShortcut({
      binding: exampleBinding('spotlight', 'KeyC'),
      onTriggered: vi.fn(),
    })

    expect(result).toEqual({ id: 'spotlight', ok: false, reason: ShortcutFailureReasons.Conflict })
    expect(m.unregisterMock).not.toHaveBeenCalled()
    m.triggerCallbacks.get('CmdOrCtrl+Shift+A')?.()
    expect(oldTriggered).toHaveBeenCalledTimes(1)
  })

  it('replaces the callback when rebinding a main-owned shortcut to the same accelerator', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const oldTriggered = vi.fn()
    const nextTriggered = vi.fn()

    service.registerMainShortcut({
      binding: exampleBinding('spotlight', 'KeyA'),
      onTriggered: oldTriggered,
    })
    const result = service.registerMainShortcut({
      binding: exampleBinding('spotlight', 'KeyA'),
      onTriggered: nextTriggered,
    })

    expect(result).toEqual({ id: 'spotlight', ok: true })
    expect(m.unregisterMock).toHaveBeenCalledWith('CmdOrCtrl+Shift+A')
    m.triggerCallbacks.get('CmdOrCtrl+Shift+A')?.()
    expect(oldTriggered).not.toHaveBeenCalled()
    expect(nextTriggered).toHaveBeenCalledTimes(1)
  })

  it('rejects a uiohook binding whose key combination a main-owned Electron binding uses', async () => {
    // Review: https://github.com/moeru-ai/airi/pull/2729#discussion_r4239027482
    // The uiohook driver does not consume key events, so a hold binding on the Spotlight accelerator fired both.
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    service.registerMainShortcut({ binding: exampleBinding('spotlight', 'KeyA'), onTriggered: vi.fn() })
    const ctx = createMockContext()
    registerMockWindow(service, ctx)

    const handler = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    const result = await handler({ id: 'ptt', accelerator: { modifiers: ['shift', 'cmd-or-ctrl'], key: 'KeyA' }, scope: 'global', receiveKeyUps: true })

    expect(result).toEqual({ id: 'ptt', ok: false, reason: ShortcutFailureReasons.Conflict })
    const list = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:list')!
    expect(list(undefined)).toEqual([exampleBinding('spotlight', 'KeyA')])
  })

  it('rejects a main-owned rebinding to a key combination that a uiohook binding uses', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const ctx = createMockContext()
    registerMockWindow(service, ctx)
    const handler = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    await handler({ ...exampleBinding('ptt', 'Space'), receiveKeyUps: true })

    const result = service.registerMainShortcut({ binding: exampleBinding('spotlight', 'Space'), onTriggered: vi.fn() })

    expect(result).toEqual({ id: 'spotlight', ok: false, reason: ShortcutFailureReasons.Conflict })
    expect(m.registerMock).not.toHaveBeenCalled()
  })

  it('allows a binding to keep its own key combination when it rebinds', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    service.registerMainShortcut({ binding: exampleBinding('spotlight', 'KeyA'), onTriggered: vi.fn() })

    const result = service.registerMainShortcut({ binding: exampleBinding('spotlight', 'KeyA'), onTriggered: vi.fn() })

    expect(result).toEqual({ id: 'spotlight', ok: true })
  })

  it('allows re-register after explicit unregister', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const ctx = createMockContext()
    registerMockWindow(service, ctx)

    const reg = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    const unreg = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:unregister')!

    reg(exampleBinding('toggle', 'KeyK'))
    unreg({ id: 'toggle' })
    const result = reg(exampleBinding('toggle', 'KeyZ')) as { ok: boolean }

    expect(result.ok).toBe(true)
    expect(m.registerMock).toHaveBeenLastCalledWith('CmdOrCtrl+Shift+Z', expect.any(Function))
  })

  it('broadcasts a "down" trigger to every registered context', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const ctxA = createMockContext()
    const ctxB = createMockContext()
    registerMockWindow(service, ctxA)
    registerMockWindow(service, ctxB)

    const handler = ctxA.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    handler(exampleBinding('toggle'))

    const callback = m.triggerCallbacks.get('CmdOrCtrl+Shift+K')
    expect(callback).toBeDefined()
    callback!()

    expect(ctxA.emit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'eventa:event:electron:shortcut:triggered' }),
      { id: 'toggle', phase: 'down' },
    )
    expect(ctxB.emit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'eventa:event:electron:shortcut:triggered' }),
      { id: 'toggle', phase: 'down' },
    )
  })

  it('unregister removes the active binding', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const ctx = createMockContext()
    registerMockWindow(service, ctx)

    const reg = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    reg(exampleBinding('toggle'))
    const unreg = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:unregister')!
    unreg({ id: 'toggle' })

    expect(m.unregisterMock).toHaveBeenCalledWith('CmdOrCtrl+Shift+K')
  })

  it('list returns currently active bindings', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const ctx = createMockContext()
    registerMockWindow(service, ctx)

    const reg = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    reg(exampleBinding('a', 'KeyA'))
    reg(exampleBinding('b', 'KeyB'))

    const list = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:list')!
    const result = list(undefined) as ShortcutBinding[]
    expect(result.map(b => b.id).sort()).toEqual(['a', 'b'])
  })

  it('unregisterAll only unregisters bindings owned by this service', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const ctx = createMockContext()
    registerMockWindow(service, ctx)

    const reg = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    reg(exampleBinding('a', 'KeyA'))
    reg(exampleBinding('b', 'KeyB'))
    const unregAll = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:unregister-all')!
    unregAll(undefined)

    expect(m.unregisterAllMock).not.toHaveBeenCalled()
    expect(m.unregisterMock).toHaveBeenCalledTimes(2)
    expect(m.unregisterMock).toHaveBeenCalledWith('CmdOrCtrl+Shift+A')
    expect(m.unregisterMock).toHaveBeenCalledWith('CmdOrCtrl+Shift+B')

    const list = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:list')!
    expect(list(undefined)).toEqual([])
  })

  it('removes a context from broadcast set when its window closes', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()

    const ctxA = createMockContext()
    const ctxB = createMockContext()
    const winA = registerMockWindow(service, ctxA)
    registerMockWindow(service, ctxB)

    const handler = ctxA.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    handler(exampleBinding('toggle'))

    // ctxA's window closes; subsequent triggers should only reach ctxB
    winA.close()
    const callback = m.triggerCallbacks.get('CmdOrCtrl+Shift+K')!
    callback()

    expect(ctxA.emit).not.toHaveBeenCalled()
    expect(ctxB.emit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'eventa:event:electron:shortcut:triggered' }),
      { id: 'toggle', phase: 'down' },
    )
  })

  it('hooks dispose into onAppBeforeQuit and clears state on call', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    expect(m.onAppBeforeQuitMock).toHaveBeenCalledTimes(1)

    const ctx = createMockContext()
    registerMockWindow(service, ctx)
    const reg = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    reg(exampleBinding('a'))

    service.dispose()
    expect(m.unregisterMock).toHaveBeenCalledWith('CmdOrCtrl+Shift+K')

    // After dispose, a fresh trigger callback should not reach contexts
    const callback = m.triggerCallbacks.get('CmdOrCtrl+Shift+K')
    callback?.()
    expect(ctx.emit).not.toHaveBeenCalled()
  })

  it('rejects malformed register payloads at the IPC boundary', async () => {
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const ctx = createMockContext()
    registerMockWindow(service, ctx)

    const reg = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:register')!
    expect(() => reg({})).toThrow(TypeError)
    expect(() => reg({ id: 'no-accel' })).toThrow(TypeError)
    expect(() => reg({ accelerator: { modifiers: [], key: 'KeyK' } })).toThrow(TypeError)
    expect(m.registerMock).not.toHaveBeenCalled()
  })

  it('ignores unregister payloads with missing id and skips unknown ids', async () => {
    // The Eventa contract types `payload` as `{ id: string }`, so a
    // `null`/`undefined` payload is a programmer error and surfaces as
    // a thrown TypeError. A well-shaped payload with an empty or
    // unknown id is a no-op.
    const m = await setupMocks()
    const service = m.setupGlobalShortcutService()
    const ctx = createMockContext()
    registerMockWindow(service, ctx)

    const unreg = ctx.invokeHandlers.get('eventa:invoke:electron:shortcut:unregister')!
    expect(() => unreg({ id: '' })).not.toThrow()
    expect(() => unreg({ id: 'never-registered' })).not.toThrow()
    expect(m.unregisterMock).not.toHaveBeenCalled()
  })
})

describe('setupGlobalShortcutService with the GlobalShortcuts portal on a private daemon', () => {
  const ptt: ShortcutBinding = {
    id: 'voice-push-to-talk',
    accelerator: { modifiers: ['ctrl', 'shift'], key: 'Space' },
    scope: 'global',
    receiveKeyUps: true,
    description: 'Push to Talk',
  }
  let fake: FakePortal
  let service: GlobalShortcutService | undefined

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    fake = new FakePortal()
    await fake.start()
    await fake.install()
  })

  afterEach(async () => {
    await service?.dispose()
    service = undefined
    await fake.close()
  })

  async function setup(host: HostId, uiohook?: 'running' | 'load-fails' | 'start-fails', withPortal = true) {
    const m = await setupMocks({ host, uiohook })
    const portal: GlobalShortcutServiceOptions['portal'] = withPortal ? { openBus: async () => fake.client, requestTimeoutMs: 200 } : undefined
    service = m.setupGlobalShortcutService({ portal })
    const ctx = createMockContext()
    registerMockWindow(service, ctx)
    const invoke = (name: string, payload: unknown) => ctx.invokeHandlers.get(`eventa:invoke:electron:shortcut:${name}`)!(payload)
    return {
      ...m,
      register: async (binding: ShortcutBinding) => await invoke('register', binding),
      // The renderer unregisters before each registration, so a reload or rebind is idempotent.
      rebind: async (binding: ShortcutBinding) => {
        await invoke('unregister', { id: binding.id })
        return await invoke('register', binding)
      },
      unregister: (id: string) => invoke('unregister', { id }),
      list: () => (invoke('list', undefined) as ShortcutBinding[]).map(binding => binding.id),
      triggers: () => ctx.emit.mock.calls.map(([, body]) => body),
    }
  }

  it.each(['linux-wayland', 'linux-xwayland'] as const)('binds key-up bindings through the portal on %s and delivers down then up', async (host) => {
    const s = await setup(host)

    expect(await s.register(ptt)).toEqual({ id: ptt.id, ok: true })
    expect(await s.register(exampleBinding('toggle'))).toEqual({ id: 'toggle', ok: true })
    expect(s.uiohookRegister).not.toHaveBeenCalled()
    expect(s.registerMock).toHaveBeenCalledTimes(1)
    expect(s.registerMock).toHaveBeenCalledWith('CmdOrCtrl+Shift+K', expect.any(Function))
    expect(fake.requested).toEqual([[ptt.id, { description: 'Push to Talk', preferred_trigger: 'CTRL+SHIFT+space' }]])
    expect(s.states).toEqual(['session', 'bound'])
    expect(s.list().sort()).toEqual(['toggle', ptt.id].sort())

    fake.key('Activated')
    fake.key('Deactivated')
    await fake.drain()
    expect(s.triggers()).toEqual([{ id: ptt.id, phase: 'down' }, { id: ptt.id, phase: 'up' }])
  })

  it('reports a denied bind and keeps the binding inactive', async () => {
    const s = await setup('linux-wayland')
    fake.code = 1

    expect(await s.register(ptt)).toEqual({ id: ptt.id, ok: false, reason: ShortcutFailureReasons.Denied })
    expect(s.states).toEqual(['session'])
    expect(s.list()).toEqual([])
  })

  it.each(['load-fails', 'start-fails'] as const)('falls back to the portal on native X11 when uiohook %s', async (uiohook) => {
    const s = await setup('linux-x11', uiohook)

    expect(await s.register(ptt)).toEqual({ id: ptt.id, ok: true })
    expect(s.states).toEqual(['session', 'bound'])
    if (uiohook === 'start-fails')
      expect(s.uiohookUnregister).toHaveBeenCalledWith(ptt.id)
  })

  it('keeps uiohook on native X11 while its hook runs', async () => {
    const s = await setup('linux-x11', 'running')

    expect(await s.register(ptt)).toEqual({ id: ptt.id, ok: true })
    expect(s.uiohookRegister).toHaveBeenCalledWith(ptt)
    expect(fake.createCount).toBe(0)
  })

  it('keeps uiohook and never reads the host without a portal', async () => {
    const s = await setup('linux-wayland', 'running', false)

    expect(await s.register(ptt)).toEqual({ id: ptt.id, ok: true })
    expect(s.uiohookRegister).toHaveBeenCalledWith(ptt)
    expect(s.getCurrentHostCapabilities).not.toHaveBeenCalled()
    expect(fake.createCount).toBe(0)
  })

  it('drops the binding when the portal closes the session and binds again on the next registration', async () => {
    const s = await setup('linux-wayland')
    await s.register(ptt)
    const absent = once(s.stateEvents, 'absent', { signal: AbortSignal.timeout(2000) })

    fake.service.emitSignal(fake.session, sessionInterface, 'Closed', 'a{sv}', [{}])
    await absent
    expect(s.list()).toEqual([])

    expect(await s.rebind(ptt)).toEqual({ id: ptt.id, ok: true })
    expect(s.states).toEqual(['session', 'bound', 'absent', 'session', 'bound'])
    expect(s.list()).toEqual([ptt.id])
  })

  it('keeps exactly one portal session through repeated enable and disable', async () => {
    const s = await setup('linux-wayland')

    for (let round = 0; round < 5; round++) {
      expect(await s.rebind(ptt)).toEqual({ id: ptt.id, ok: true })
      expect(s.states.at(-1)).toBe('bound')
      expect(s.list()).toEqual([ptt.id])

      // Disabling releases the binding; the portal then holds an empty session.
      const released = once(s.stateEvents, 'session', { signal: AbortSignal.timeout(2000) })
      s.unregister(ptt.id)
      await released
      expect(s.list()).toEqual([])
    }
    expect(fake.createCount - fake.closedSessions.length).toBe(1)
  })

  it('bounds a portal that never answers and binds once it answers again', async () => {
    const s = await setup('linux-wayland')
    fake.hold = 'BindShortcuts'

    expect(await s.register(ptt)).toEqual({ id: ptt.id, ok: false, reason: ShortcutFailureReasons.Denied })
    expect(s.list()).toEqual([])

    fake.hold = undefined
    expect(await s.rebind(ptt)).toEqual({ id: ptt.id, ok: true })
    expect(s.states.at(-1)).toBe('bound')
  })

  it('claims no portal state before a binding and closes the session on dispose', async () => {
    const s = await setup('linux-wayland')
    expect(s.states).toEqual([])
    expect(fake.createCount).toBe(0)

    await s.register(ptt)
    const session = fake.session
    await service!.dispose()
    service = undefined

    expect(s.states.at(-1)).toBe('absent')
    expect(fake.closedSessions).toContain(session)
  })
})
