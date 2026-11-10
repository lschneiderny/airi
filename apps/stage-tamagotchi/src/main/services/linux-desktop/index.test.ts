import type { LinuxDesktopFacts } from '@proj-airi/stage-shared/host-capabilities'

import { EventEmitter, once } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pid } from 'node:process'

import { createContext } from '@moeru/eventa'
import { electronEvents } from '@proj-airi/electron-eventa'
import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPowerMonitorService } from '../electron/powerMonitor'
import { createLinuxDesktopBridge } from './index'
import { PrivateBus } from './session/private-bus.test-helper'

const facts = vi.hoisted(() => vi.fn())
vi.mock('../electron/host-capabilities', () => ({ reportLinuxDesktop: facts }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: { getAppMetrics: () => [{ pid }] },
    powerMonitor: new EventEmitter(),
  }
})

describe('linux desktop bridge', () => {
  let bus: PrivateBus
  let directory: string
  let bridge: ReturnType<typeof createLinuxDesktopBridge>
  const loaded = new Map<number, string>()
  const reachedRun = new EventTarget()

  beforeEach(async () => {
    bus = new PrivateBus()
    await bus.start()
    directory = await mkdtemp(join(tmpdir(), 'airi-bridge-test-'))
    loaded.clear()
    facts.mockReset()
  })

  afterEach(async () => {
    await bridge?.stop()
    await bus.close()
    await rm(directory, { recursive: true, force: true })
    vi.useRealTimers()
  })

  function create(env: Record<string, string> = { XDG_CURRENT_DESKTOP: 'KDE' }) {
    bridge = createLinuxDesktopBridge({
      env: { ...env, XDG_RUNTIME_DIR: directory },
      tempDir: directory,
      sessionBus: bus.client,
      systemBus: bus.client,
    })
    return bridge
  }

  async function compositor(hello = true, api = 'plasma6') {
    await bus.name('org.kde.KWin')
    const owner = await bus.service.getNameOwner('ai.airi.SessionClient')
    bus.service.exportObject('/Scripting', {
      name: 'org.kde.kwin.Scripting',
      methods: {
        loadScript: { signature: 'ss', outSignature: 'i', handler: (_path, name) => {
          const id = loaded.size + 1
          loaded.set(id, String(name))
          return id
        } },
        unloadScript: { signature: 's', outSignature: 'b', handler: (name) => {
          for (const [id, plugin] of loaded) {
            if (plugin === name)
              loaded.delete(id)
          }
          return true
        } },
        isScriptLoaded: { signature: 's', outSignature: 'b', handler: name => [...loaded.values()].includes(String(name)) },
      },
    }, { allowedSender: () => owner })
    bus.method('/Scripting/Script1', 'org.kde.kwin.Script', 'run', '', '', async () => {
      reachedRun.dispatchEvent(new Event('run'))
      if (hello)
        await push('Hello', { api })
    })
    for (const id of [2, 3, 4])
      bus.method(`/Scripting/Script${id}`, 'org.kde.kwin.Script', 'run', '', '', () => {})
  }

  function push(member: string, payload: unknown) {
    return bus.service.call({
      destination: `ai.moeru.airi.LinuxDesktop.p${pid}`,
      path: '/bridge',
      interface: 'ai.moeru.airi.LinuxDesktop1',
      member,
      signature: 's',
      body: [JSON.stringify(payload)],
    })
  }

  function lockFacts() {
    const events = new EventTarget()
    let desktop: LinuxDesktopFacts = {
      backend: 'gnome',
      bridge: 'starting',
      bridgeFailure: null,
      foregroundVerified: false,
      cursorVerified: false,
      geometryVerified: false,
      keepAboveVerified: false,
      lockSource: null,
      portalShortcuts: 'absent',
      clickThroughToggle: false,
      systemAudioVerified: false,
    }
    facts.mockImplementation((patch: Partial<LinuxDesktopFacts>) => {
      desktop = { ...desktop, ...patch }
      if ('lockSource' in patch)
        events.dispatchEvent(new Event('source'))
    })
    return {
      changed: () => once(events, 'source', { signal: AbortSignal.timeout(2000) }),
      status: () => capabilitiesForHost('linux-wayland', desktop).signals.screenLock,
    }
  }

  it.each(['screensaver', 'logind'] as const)('revokes %s lock verification on owner loss until a fresh read completes', async (source) => {
    const saver = 'org.freedesktop.ScreenSaver'
    const login = 'org.freedesktop.login1'
    const name = source === 'screensaver' ? saver : login
    const pending = Promise.withResolvers<boolean>()
    const entered = new EventTarget()
    let recovering = false
    if (source === 'screensaver') {
      bus.method('/org/freedesktop/ScreenSaver', saver, 'GetActive', '', 'b', () => {
        if (!recovering)
          return false
        entered.dispatchEvent(new Event('read'))
        return pending.promise
      })
    }
    else {
      bus.method('/org/freedesktop/login1', `${login}.Manager`, 'GetSessionByPID', 'u', 'o', async () => {
        if (recovering) {
          entered.dispatchEvent(new Event('read'))
          await pending.promise
        }
        return '/org/freedesktop/login1/session/test'
      })
      bus.property('/org/freedesktop/login1/session/test', `${login}.Session`, 'LockedHint', 'b', () => false)
    }
    await bus.name(name)
    const lock = lockFacts()
    const ready = lock.changed()
    create({ XDG_CURRENT_DESKTOP: 'GNOME' })
    await bridge.start()
    await ready
    expect(lock.status()).toEqual({ kind: 'live' })

    const revoked = lock.changed()
    await bus.service.call({
      destination: 'org.freedesktop.DBus',
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus',
      member: 'ReleaseName',
      signature: 's',
      body: [name],
    })
    await revoked
    expect(lock.status()).toEqual({ kind: 'degraded', reason: 'linux-lock-events-undocumented' })

    recovering = true
    const reading = once(entered, 'read', { signal: AbortSignal.timeout(2000) })
    const restored = lock.changed()
    await bus.name(name)
    await reading
    expect(lock.status()).toEqual({ kind: 'degraded', reason: 'linux-lock-events-undocumented' })
    pending.resolve(false)
    await restored
    expect(lock.status()).toEqual({ kind: 'live' })
  })

  it('revokes lock verification after a failed logind reread and verifies a new baseline', async () => {
    const login = 'org.freedesktop.login1'
    const path = '/org/freedesktop/login1/session/test'
    await bus.name(login)
    bus.method('/org/freedesktop/login1', `${login}.Manager`, 'GetSessionByPID', 'u', 'o', () => path)
    const unexport = bus.service.exportReadOnlyProperties(path, `${login}.Session`, {
      LockedHint: { signature: 'b', get: () => false },
    })
    const lock = lockFacts()
    const ready = lock.changed()
    create({ XDG_CURRENT_DESKTOP: 'GNOME' })
    const transitions = vi.fn()
    bridge.onLock(transitions)
    await bridge.start()
    await ready
    expect(lock.status()).toEqual({ kind: 'live' })

    unexport()
    const revoked = lock.changed()
    const invalidate = () => bus.service.emitSignal(path, 'org.freedesktop.DBus.Properties', 'PropertiesChanged', 'sa{sv}as', [
      `${login}.Session`,
      {},
      ['LockedHint'],
    ])
    invalidate()
    await revoked
    expect(lock.status()).toEqual({ kind: 'degraded', reason: 'linux-lock-events-undocumented' })

    bus.property(path, `${login}.Session`, 'LockedHint', 'b', () => true)
    const restored = lock.changed()
    invalidate()
    await restored
    expect(lock.status()).toEqual({ kind: 'live' })
    expect(transitions).not.toHaveBeenCalled()
  })

  it('revokes lock verification when its private bus disconnects', async () => {
    await bus.name('org.freedesktop.ScreenSaver')
    bus.method('/org/freedesktop/ScreenSaver', 'org.freedesktop.ScreenSaver', 'GetActive', '', 'b', () => false)
    const lock = lockFacts()
    const ready = lock.changed()
    create({ XDG_CURRENT_DESKTOP: 'GNOME' })
    await bridge.start()
    await ready
    expect(lock.status()).toEqual({ kind: 'live' })
    const revoked = lock.changed()
    await bus.close()
    await revoked
    expect(lock.status()).toEqual({ kind: 'degraded', reason: 'linux-lock-events-undocumented' })
  })

  it.each([
    [{ XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-1' }, 'none'],
    [{ XDG_CURRENT_DESKTOP: 'GNOME' }, 'gnome'],
  ] as const)('keeps desktop %j without a window source reason-only', async (env, backend) => {
    create(env)
    await bridge.start()
    expect(bridge.backend).toBe(backend)
    expect(facts).toHaveBeenCalledWith(expect.objectContaining({ backend, bridge: 'ready' }))
    expect(bridge.activeWindow()).toBeNull()
    expect(bridge.cursor()).toBeNull()
    expect(bridge.ownWindows()).toBeNull()
  })

  it('confirms KWin ownership and keeps failure facts when the name is absent', async () => {
    create()
    await bridge.start()
    expect(bridge.backend).toBe('kwin')
    expect(facts).toHaveBeenLastCalledWith(expect.objectContaining({ bridge: 'failed', bridgeFailure: 'other' }))
    expect(loaded.size).toBe(0)
  })

  it('preserves the unsupported API reason through startup rejection', async () => {
    await compositor(true, 'unsupported')
    create()
    await bridge.start()
    expect(facts.mock.calls.filter(([patch]) => patch.bridge === 'failed').at(-1)?.[0])
      .toMatchObject({ bridgeFailure: 'api-unsupported' })
  })

  it('publishes ready after Hello, delivers pushes, then clears values on stop', async () => {
    await compositor()
    create()
    const cursor = vi.fn()
    bridge.onCursor(cursor)
    await bridge.start()
    expect(facts).toHaveBeenCalledWith(expect.objectContaining({ backend: 'kwin', bridge: 'ready' }))
    await bridge.setCursorStreaming(true)
    await push('Cursor', { x: 10, y: 20 })
    expect(cursor).toHaveBeenCalledWith({ x: 10, y: 20 })
    expect(bridge.cursor()).toEqual({ x: 10, y: 20 })
    await bridge.stop()
    expect(bridge.cursor()).toBeNull()
    expect(loaded.size).toBe(0)
    expect(await readdir(join(directory, 'airi-kwin'))).toEqual([])
  })

  it('holds outputs and readiness, and drops the cursor reading when streaming stops', async () => {
    await compositor()
    create()
    const states: string[] = []
    bridge.onState(state => states.push(state))
    expect(bridge.ready()).toBe(false)
    await bridge.start()
    expect(bridge.ready()).toBe(true)
    const outputs = [{ name: 'DP-1', x: 0, y: 0, width: 1920, height: 1080, scale: 1 }]
    const pushed = vi.fn()
    bridge.onOutputs(pushed)
    await push('Outputs', outputs)
    expect(bridge.outputs()).toEqual(outputs)
    expect(pushed).toHaveBeenCalledWith(outputs)
    await bridge.setCursorStreaming(true)
    await push('Cursor', { x: 1, y: 2 })
    expect(bridge.cursor()).toEqual({ x: 1, y: 2 })
    await bridge.setCursorStreaming(false)
    expect(bridge.cursor()).toBeNull()
    await bridge.stop()
    expect(bridge.outputs()).toBeNull()
    expect(bridge.ready()).toBe(false)
    expect(states).toEqual(['ready', 'stopped'])
  })

  it('drops the cursor reading when the cursor script is found unloaded', async () => {
    await compositor()
    create()
    await bridge.start()
    await bridge.setCursorStreaming(true)
    await push('Cursor', { x: 5, y: 6 })
    for (const [id, name] of loaded) {
      if (name.includes('cursor'))
        loaded.delete(id)
    }
    const cursor = vi.fn()
    bridge.onCursor(cursor)
    await bridge.setCursorStreaming(true)
    expect(cursor).toHaveBeenCalledWith(null)
    expect(bridge.cursor()).toBeNull()
  })

  it('cancels startup and unloads a script while Hello is pending', async () => {
    await compositor(false)
    create()
    const run = once(reachedRun, 'run', { signal: AbortSignal.timeout(2000) })
    const starting = bridge.start()
    await run
    await bridge.stop()
    await starting
    expect(loaded.size).toBe(0)
    expect(await readdir(join(directory, 'airi-kwin'))).toEqual([])
    expect(facts.mock.calls.some(([patch]) => patch.bridge === 'ready')).toBe(false)
  })

  it('revokes compositor values on owner loss and returns ready after a new handshake', async () => {
    await compositor()
    create()
    await bridge.start()
    await push('Cursor', { x: 10, y: 20 })
    await push('Outputs', [{ name: 'DP-1', x: 0, y: 0, width: 1920, height: 1080, scale: 1 }])
    const revoked = Promise.withResolvers<void>()
    const ready = Promise.withResolvers<void>()
    facts.mockImplementation((patch) => {
      if (patch.bridge === 'starting')
        revoked.resolve()
      if (patch.bridge === 'ready')
        ready.resolve()
    })
    await bus.service.call({
      destination: 'org.freedesktop.DBus',
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus',
      member: 'ReleaseName',
      signature: 's',
      body: ['org.kde.KWin'],
    })
    await revoked.promise
    expect(bridge.cursor()).toBeNull()
    expect(bridge.outputs()).toBeNull()
    expect(bridge.ready()).toBe(false)
    loaded.clear()
    await bus.name('org.kde.KWin')
    await ready.promise
    expect(facts).toHaveBeenCalledWith(expect.objectContaining({
      bridge: 'starting',
      cursorVerified: false,
      geometryVerified: false,
      foregroundVerified: false,
      keepAboveVerified: false,
    }))
    expect([...loaded.values()]).toEqual([`airi-desktop-bridge-${pid}`])
  })

  it('bounds an unanswered Hello at two seconds', async () => {
    await compositor(false)
    create()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const run = once(reachedRun, 'run', { signal: AbortSignal.timeout(2000) })
    const starting = bridge.start()
    await run
    await vi.advanceTimersByTimeAsync(1999)
    expect(facts.mock.calls.some(([patch]) => patch.bridge === 'failed')).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await starting
    expect(facts).toHaveBeenLastCalledWith(expect.objectContaining({ bridge: 'failed' }))
    await bridge.stop()
    expect(loaded.size).toBe(0)
  })

  it('keeps a reported lock source live after an unanswered Hello', async () => {
    await bus.name('org.freedesktop.ScreenSaver')
    bus.method('/org/freedesktop/ScreenSaver', 'org.freedesktop.ScreenSaver', 'GetActive', '', 'b', () => false)
    await compositor(false)
    create()
    const events = new EventTarget()
    facts.mockImplementation((patch) => {
      if (patch.lockSource === 'screensaver')
        events.dispatchEvent(new Event('lock-ready'))
    })
    const locks: boolean[] = []
    bridge.onLock((locked) => {
      locks.push(locked)
      events.dispatchEvent(new Event('lock'))
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const lockReady = once(events, 'lock-ready', { signal: AbortSignal.timeout(2000) })
    const run = once(reachedRun, 'run', { signal: AbortSignal.timeout(2000) })
    const starting = bridge.start()
    await Promise.all([run, lockReady])
    await vi.advanceTimersByTimeAsync(2000)
    await starting
    expect(facts).toHaveBeenCalledWith(expect.objectContaining({ bridge: 'failed' }))
    // A reported lock source must keep delivering; it is never left set without a subscription.
    const locked = once(events, 'lock', { signal: AbortSignal.timeout(2000) })
    bus.service.emitSignal('/org/freedesktop/ScreenSaver', 'org.freedesktop.ScreenSaver', 'ActiveChanged', 'b', [true])
    await locked
    expect(locks).toEqual([true])
    expect(facts.mock.calls.filter(([patch]) => 'lockSource' in patch).at(-1)?.[0]).toEqual({ lockSource: 'screensaver' })
  })

  it('forwards Linux lock transitions to the owning window and removes closed subscribers', async () => {
    await bus.name('org.freedesktop.ScreenSaver')
    bus.method('/org/freedesktop/ScreenSaver', 'org.freedesktop.ScreenSaver', 'GetActive', '', 'b', () => false)
    create({ XDG_CURRENT_DESKTOP: 'GNOME' })
    const context = createContext()
    const window = new EventEmitter()
    const transitions: string[] = []
    const events = new EventTarget()
    const lockReady = once(events, 'lock-ready', { signal: AbortSignal.timeout(2000) })
    facts.mockImplementation((patch) => {
      if (patch.lockSource === 'screensaver')
        events.dispatchEvent(new Event('lock-ready'))
    })
    context.on(electronEvents.powerMonitor.lockScreen, () => {
      transitions.push('locked')
      events.dispatchEvent(new Event('change'))
    })
    context.on(electronEvents.powerMonitor.unlockScreen, () => {
      transitions.push('unlocked')
      events.dispatchEvent(new Event('change'))
    })
    createPowerMonitorService({ context: context as never, window: window as never, bridge })
    await bridge.start()
    await lockReady
    expect(facts).toHaveBeenCalledWith({ lockSource: 'screensaver' })
    for (const locked of [true, false]) {
      const changed = once(events, 'change', { signal: AbortSignal.timeout(2000) })
      bus.service.emitSignal('/org/freedesktop/ScreenSaver', 'org.freedesktop.ScreenSaver', 'ActiveChanged', 'b', [locked])
      await changed
    }
    window.emit('closed')
    bus.service.emitSignal('/org/freedesktop/ScreenSaver', 'org.freedesktop.ScreenSaver', 'ActiveChanged', 'b', [true])
    await bus.drain()
    expect(transitions).toEqual(['locked', 'unlocked'])
  })
})
