import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

import bridgeSource from './bridge-script.js?raw'
import cursorSource from './cursor-script.js?raw'

import { parseActive, parseCursor, parseHello, parseOwnWindows } from './protocol'

class Signal {
  private readonly listeners = new Set<() => void>()
  connect(listener: () => void) { this.listeners.add(listener) }
  disconnect(listener: () => void) { this.listeners.delete(listener) }
  emit() { for (const listener of this.listeners) listener() }
}

function windowFixture(pid = 42) {
  return {
    pid,
    internalId: `{window-${pid}}`,
    caption: 'untrusted',
    resourceClass: 'konsole',
    desktopFileName: 'org.kde.konsole',
    fullScreen: false,
    keepAbove: true,
    clientGeometry: { x: 10, y: 20, width: 800, height: 600 },
    frameGeometry: { x: 5, y: 10, width: 810, height: 615 },
    output: { devicePixelRatio: 1.25 },
    captionChanged: new Signal(),
    fullScreenChanged: new Signal(),
    frameGeometryChanged: new Signal(),
    keepAboveChanged: new Signal(),
  }
}

// A destroyed KWin window keeps its script wrapper, but every property reads as undefined.
function destroy(window: Record<string, unknown>) {
  for (const key of Object.keys(window))
    window[key] = undefined
}

function scriptHarness(source: string, workspace: object) {
  const calls: { method: string, payload: string | undefined, reply: (value?: string) => void }[] = []
  // KWin swallows exceptions thrown inside a callDBus reply callback.
  const swallowed: unknown[] = []
  runInNewContext(source.replaceAll('__AIRI_BUS_NAME__', 'ai.moeru.airi.LinuxDesktop.p42'), {
    workspace,
    callDBus: (_bus: string, _path: string, _iface: string, method: string, ...args: unknown[]) => {
      const callback = args.at(-1)
      if (typeof callback !== 'function')
        throw new TypeError('Every call must wait for a reply')
      calls.push({
        method,
        payload: typeof args[0] === 'string' ? args[0] : undefined,
        reply: (value) => {
          try {
            callback(value)
          }
          catch (error) {
            swallowed.push(error)
          }
        },
      })
    },
  })
  function replyNext() {
    const call = calls.shift()
    if (!call)
      throw new Error('No pending script call')
    call.reply(call.method === 'OwnPids' ? '[42]' : undefined)
    return call
  }
  return { calls, replyNext, swallowed }
}

describe('kwin scripts', () => {
  it('coalesces cursor events and delivers the final position only after the reply', () => {
    const workspace = { cursorPos: { x: 1, y: 2 }, cursorPosChanged: new Signal() }
    const harness = scriptHarness(cursorSource, workspace)
    expect(parseCursor(harness.calls[0]?.payload)).toEqual({ x: 1, y: 2 })
    for (let x = 3; x <= 100; x++) {
      workspace.cursorPos = { x, y: 2 }
      workspace.cursorPosChanged.emit()
    }
    expect(harness.calls).toHaveLength(1)
    harness.replyNext()
    expect(parseCursor(harness.calls[0]?.payload)).toEqual({ x: 100, y: 2 })
    harness.replyNext()
    workspace.cursorPosChanged.emit()
    expect(harness.calls).toHaveLength(0)
  })

  it('stops sending cursor events when a failed call receives no reply callback', () => {
    const workspace = { cursorPos: { x: 1, y: 2 }, cursorPosChanged: new Signal() }
    const harness = scriptHarness(cursorSource, workspace)
    // KWin suppresses the callback on error, including receiver disappearance.
    harness.calls.shift()
    workspace.cursorPos = { x: 50, y: 60 }
    workspace.cursorPosChanged.emit()
    expect(harness.calls).toEqual([])
  })

  it.each(['plasma6', 'plasma5'] as const)('reports the foreign active window while discovering only own windows through the %s API', (api) => {
    const own = windowFixture()
    const active = windowFixture(99)
    // An inactive foreign window exposes only pid during own-window discovery.
    const other = {
      pid: 100,
      get caption() { throw new Error('Private caption read') },
      get frameGeometry() { throw new Error('Private geometry read') },
    }
    const activated = new Signal()
    const added = new Signal()
    const removed = new Signal()
    const workspace = api === 'plasma6'
      ? { activeWindow: active, windowActivated: activated, windowAdded: added, windowRemoved: removed, stackingOrder: [active, own, other] }
      : { activeClient: active, clientActivated: activated, clientAdded: added, clientRemoved: removed, clientList: () => [active, own, other] }
    const harness = scriptHarness(bridgeSource, workspace)
    expect(parseHello(harness.calls[0]?.payload)).toEqual({ api })
    const messages = []
    while (harness.calls.length)
      messages.push(harness.replyNext())
    expect(parseActive(messages.find(call => call.method === 'Active')?.payload)).toEqual({
      caption: 'untrusted',
      resourceClass: 'konsole',
      desktopFileName: 'org.kde.konsole',
      pid: 99,
      fullScreen: false,
    })
    expect(parseOwnWindows(messages.find(call => call.method === 'OwnWindows')?.payload)).toEqual([{
      id: '{window-42}',
      pid: 42,
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      keepAbove: true,
      outputScale: 1.25,
    }])

    active.caption = 'changed'
    active.captionChanged.emit()
    active.fullScreen = true
    active.fullScreenChanged.emit()
    expect(harness.calls).toHaveLength(1)
    expect(parseActive(harness.calls[0]?.payload)?.caption).toBe('changed')
    harness.replyNext()
    expect(parseActive(harness.calls[0]?.payload)?.fullScreen).toBe(true)
    harness.replyNext()
    own.clientGeometry.x = 80
    own.frameGeometryChanged.emit()
    expect(parseOwnWindows(harness.calls[0]?.payload)[0]?.x).toBe(80)
    harness.replyNext()
    added.emit()
    expect(harness.calls[0]?.method).toBe('OwnPids')
  })

  it('keeps pushing Active and OwnWindows after an own active window is destroyed between pushes', () => {
    const kept = windowFixture()
    const closed = windowFixture()
    closed.internalId = '{window-closed}'
    const konsole = windowFixture(99)
    const workspace: Record<string, unknown> & { stackingOrder: object[] } = {
      activeWindow: closed,
      windowActivated: new Signal(),
      windowAdded: new Signal(),
      windowRemoved: new Signal(),
      stackingOrder: [kept, closed],
    }
    const harness = scriptHarness(bridgeSource, workspace)
    while (harness.calls.length)
      harness.replyNext()

    destroy(closed)
    workspace.stackingOrder = [kept, konsole]
    ;(workspace.windowAdded as Signal).emit()
    workspace.activeWindow = konsole
    ;(workspace.windowActivated as Signal).emit()
    const messages: { method: string, payload: string | undefined }[] = []
    while (harness.calls.length)
      messages.push(harness.replyNext())

    expect(harness.swallowed).toEqual([])
    expect(messages.map(call => call.method)).toEqual(['OwnPids', 'Active', 'OwnWindows'])
    expect(parseActive(messages[1]?.payload)?.pid).toBe(99)
    expect(parseOwnWindows(messages[2]?.payload).map(window => window.id)).toEqual(['{window-42}'])

    kept.clientGeometry.x = 80
    kept.frameGeometryChanged.emit()
    expect(parseOwnWindows(harness.replyNext().payload)[0]?.x).toBe(80)
  })

  it('keeps the pump running when a reply handler throws', () => {
    const own = windowFixture()
    const broken = {
      ...windowFixture(),
      get clientGeometry(): never {
        throw new TypeError('geometry read failed')
      },
    }
    const konsole = windowFixture(99)
    const workspace: Record<string, unknown> = {
      activeWindow: null,
      windowActivated: new Signal(),
      windowAdded: new Signal(),
      windowRemoved: new Signal(),
      stackingOrder: [own, broken],
    }
    const harness = scriptHarness(bridgeSource, workspace)
    while (harness.calls.length)
      harness.replyNext()
    expect(harness.swallowed).toHaveLength(1)

    workspace.activeWindow = konsole
    ;(workspace.windowActivated as Signal).emit()
    expect(parseActive(harness.replyNext().payload)?.pid).toBe(99)
    workspace.stackingOrder = [own]
    ;(workspace.windowAdded as Signal).emit()
    expect(harness.replyNext().method).toBe('OwnPids')
    expect(parseOwnWindows(harness.replyNext().payload).map(window => window.id)).toEqual(['{window-42}'])
  })

  it('reports unsupported without reading windows', () => {
    const harness = scriptHarness(bridgeSource, {})
    expect(parseHello(harness.replyNext().payload)).toEqual({ api: 'unsupported' })
    expect(harness.calls).toEqual([])
  })

  it.each(['plasma6', 'plasma5'] as const)('keeps foreign-window discovery inside the %s compositor and reads only pid', (api) => {
    const own = windowFixture()
    const reads: string[] = []
    const foreign = new Proxy({ pid: 987654321 }, {
      get(target, property) {
        reads.push(String(property))
        if (property !== 'pid')
          throw new Error(`Foreign ${String(property)} read`)
        return target.pid
      },
    })
    const added = new Signal()
    const workspace = api === 'plasma6'
      ? { activeWindow: null, windowActivated: new Signal(), windowAdded: added, windowRemoved: new Signal(), stackingOrder: [foreign, own] }
      : { activeClient: null, clientActivated: new Signal(), clientAdded: added, clientRemoved: new Signal(), clientList: () => [foreign, own] }
    const harness = scriptHarness(bridgeSource, workspace)
    const messages: { method: string, payload: unknown }[] = []
    function drain() {
      while (harness.calls.length) {
        const call = harness.replyNext()
        messages.push({ method: call.method, payload: call.payload === undefined ? undefined : JSON.parse(call.payload) })
      }
    }
    drain()
    added.emit()
    drain()
    expect(reads).toEqual(['pid', 'pid'])
    const ownedPayload = [{
      id: '{window-42}',
      pid: 42,
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      keepAbove: true,
      outputScale: 1.25,
    }]
    expect(messages).toEqual([
      { method: 'Hello', payload: { api } },
      { method: 'Active', payload: null },
      { method: 'OwnPids', payload: undefined },
      { method: 'OwnWindows', payload: ownedPayload },
      { method: 'OwnPids', payload: undefined },
      { method: 'OwnWindows', payload: ownedPayload },
    ])
  })

  it('disconnects inactive windows and reports a cleared active window', () => {
    const first = windowFixture()
    const second = windowFixture(43)
    const workspace: {
      activeWindow: ReturnType<typeof windowFixture> | null
      windowActivated: Signal
      windowAdded: Signal
      windowRemoved: Signal
      stackingOrder: ReturnType<typeof windowFixture>[]
    } = {
      activeWindow: first,
      windowActivated: new Signal(),
      windowAdded: new Signal(),
      windowRemoved: new Signal(),
      stackingOrder: [first, second],
    }
    const harness = scriptHarness(bridgeSource, workspace)
    while (harness.calls.length)
      harness.replyNext()
    workspace.activeWindow = second
    workspace.windowActivated.emit()
    harness.replyNext()
    first.captionChanged.emit()
    expect(harness.calls).toEqual([])
    workspace.activeWindow = null
    workspace.windowActivated.emit()
    expect(parseActive(harness.replyNext().payload)).toBeNull()
  })
})
