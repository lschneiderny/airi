import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { keepAboveScript, placementScript } from './actuator-scripts'

interface FakeWindow {
  pid: number
  internalId: string
  keepAbove: boolean
  frameGeometry: { x: number, y: number, width: number, height: number }
  clientGeometry: { x: number, y: number, width: number, height: number }
}

function window(pid: number, internalId: string): FakeWindow {
  return {
    pid,
    internalId,
    keepAbove: false,
    frameGeometry: { x: 10, y: 10, width: 304, height: 434 },
    clientGeometry: { x: 12, y: 40, width: 300, height: 400 },
  }
}

function recordingForeignWindow(pid: number) {
  const touched: string[] = []
  const target = window(pid, '{foreign}')
  const proxy = new Proxy(target, {
    get(object, key) {
      touched.push(`get:${String(key)}`)
      return Reflect.get(object, key)
    },
    has(object, key) {
      touched.push(`has:${String(key)}`)
      return Reflect.has(object, key)
    },
    set(object, key, value) {
      touched.push(`set:${String(key)}`)
      return Reflect.set(object, key, value)
    },
  })
  return { proxy, touched }
}

function run(script: string, windows: unknown[]) {
  runInNewContext(script, { workspace: { activeWindow: null, stackingOrder: windows } })
}

describe('kwin actuator scripts', () => {
  it('writes keep-above on the bound AIRI window only and reads nothing but pid from foreign windows', () => {
    const stranger = recordingForeignWindow(4242)
    const bound = window(100, '{bound}')
    const sibling = window(100, '{sibling}')
    run(keepAboveScript([100, 101], '{bound}', true), [stranger.proxy, sibling, bound])
    expect(bound.keepAbove).toBe(true)
    expect(sibling.keepAbove).toBe(false)
    expect(stranger.touched).toEqual(['get:pid'])
  })

  it('clears keep-above', () => {
    const bound = { ...window(100, '{bound}'), keepAbove: true }
    run(keepAboveScript([100], '{bound}', false), [bound])
    expect(bound.keepAbove).toBe(false)
  })

  it('writes nothing when the bound window has closed', () => {
    const stranger = recordingForeignWindow(4242)
    const sibling = window(100, '{sibling}')
    run(keepAboveScript([100], '{closed}', true), [stranger.proxy, sibling])
    expect(sibling.keepAbove).toBe(false)
    expect(stranger.touched).toEqual(['get:pid'])
  })

  it('places the client area at the requested rectangle by moving the frame', () => {
    const stranger = recordingForeignWindow(4242)
    const bound = window(100, '{bound}')
    run(placementScript([100], '{bound}', { x: 200, y: 200, width: 320, height: 240 }), [stranger.proxy, bound])
    expect(bound.frameGeometry).toEqual({ x: 198, y: 170, width: 324, height: 274 })
    expect(stranger.touched).toEqual(['get:pid'])
  })

  it('uses the Plasma 5 client list when the workspace has no active window property', () => {
    const bound = window(100, '{bound}')
    runInNewContext(keepAboveScript([100], '{bound}', true), { workspace: { clientList: () => [bound] } })
    expect(bound.keepAbove).toBe(true)
  })

  it.each([
    ['an empty id', [100], '', 'Actuators require a bound window id'],
    ['an id that could escape the script', [100], '"; workspace.x = 1; "', 'Actuators require a bound window id'],
    ['no AIRI process', [], '{bound}', 'Actuators require an AIRI process'],
  ] as const)('refuses %s', (_name, pids, id, message) => {
    expect(() => keepAboveScript(pids, id, true)).toThrow(message)
  })

  it.each([
    { x: Number.NaN, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 0, height: 10 },
    { x: 0, y: Number.POSITIVE_INFINITY, width: 10, height: 10 },
  ])('refuses the rectangle %o', (rect) => {
    expect(() => placementScript([100], '{bound}', rect)).toThrow('Placement requires a finite, non-empty rectangle')
  })
})
