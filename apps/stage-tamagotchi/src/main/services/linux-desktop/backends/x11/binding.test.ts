import { Buffer } from 'node:buffer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { X11BackendError } from './binding'
import { X11EwmhBackend } from './index'

const ffi = vi.hoisted(() => {
  interface Property {
    type: number
    format: number
    data: Uint8Array | number[]
    remaining?: number
    count?: number
    status?: number
  }
  const atoms = new Map<string, number>()
  const properties = new Map<string, Property>()
  const allocated = new Map<bigint, Property>()
  const callbacks = new Map<bigint, (display: bigint | null, event: bigint | null) => number>()
  let handler = 77n
  let next = 100n
  let failedProperty: number | undefined
  const atom = (name: string) => {
    const existing = atoms.get(name)
    if (existing !== undefined)
      return existing
    const id = atoms.size + 1
    atoms.set(name, id)
    return id
  }
  const native = {
    XOpenDisplay: vi.fn((): bigint | null => 10n),
    XDefaultRootWindow: vi.fn(() => 1),
    XInternAtom: vi.fn((_display: bigint, name: string) => atom(name)),
    XGetWindowProperty: vi.fn((_display: bigint, window: number, property: number, _offset: number, _length: number, _deleteProperty: number, _requestedType: number, actualType: [number], format: [number], count: [number], remaining: [number], data: [bigint | null]) => {
      if (property === failedProperty) {
        callbacks.get(handler)?.(10n, 90n)
        return 3
      }
      const value = properties.get(`${window}:${property}`)
      if (!value)
        return 0
      actualType[0] = value.type
      format[0] = value.format
      count[0] = value.count ?? value.data.length
      remaining[0] = value.remaining ?? 0
      data[0] = ++next
      allocated.set(data[0], value)
      return value.status ?? 0
    }),
    XSetErrorHandler: vi.fn((value: bigint) => {
      const previous = handler
      handler = value
      return previous
    }),
    XFree: vi.fn((pointer: bigint) => allocated.delete(pointer)),
    XCloseDisplay: vi.fn(() => 0),
  }
  const functions = new Map<string, unknown>(Object.entries(native))
  const load = vi.fn(() => ({
    func: (definition: string) => {
      const name = definition.match(/(\w+)\(/u)?.[1]
      if (!name || !functions.has(name))
        throw new Error(`Unexpected native function: ${definition}`)
      return functions.get(name)
    },
  }))
  const set = (window: number, name: string, type: string, format: number, data: Uint8Array | number[], overrides: Partial<Property> = {}) =>
    properties.set(`${window}:${atom(name)}`, { type: atom(type), format, data, ...overrides })
  return {
    native,
    load,
    atom,
    set,
    properties,
    allocated,
    callbacks,
    fail: (name: string) => { failedProperty = atom(name) },
    reset: () => {
      properties.clear()
      allocated.clear()
      callbacks.clear()
      failedProperty = undefined
      handler = 77n
    },
    handler: () => handler,
    register: (callback: (display: bigint | null, event: bigint | null) => number) => {
      const id = ++next
      callbacks.set(id, callback)
      return id
    },
    unregister: (id: bigint) => callbacks.delete(id),
    // Electron's V8 memory cage rejects external buffers, so koffi.view aborts the main process there.
    view: () => {
      throw new Error('External buffers are not allowed')
    },
    decode: (pointer: bigint, type: string, count: number) => {
      const data = allocated.get(pointer)?.data
      if (type === 'uint8_t') {
        if (!(data instanceof Uint8Array))
          throw new Error('Expected byte property')
        return data.slice(0, count)
      }
      if (type !== 'unsigned long')
        throw new Error('Xlib format-32 must use native unsigned long stride')
      return Array.isArray(data) ? new BigUint64Array(data.map(BigInt)) : data
    },
  }
})

vi.mock('koffi', () => ({
  load: ffi.load,
  proto: () => ({}),
  pointer: () => ({}),
  register: ffi.register,
  unregister: ffi.unregister,
  view: ffi.view,
  decode: ffi.decode,
}))

describe('x11 EWMH native boundary', () => {
  let backend: X11EwmhBackend

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DISPLAY', ':198')
    ffi.reset()
    ffi.native.XOpenDisplay.mockReturnValue(10n)
    ffi.set(1, '_NET_ACTIVE_WINDOW', 'WINDOW', 32, [20])
    ffi.set(20, '_NET_WM_NAME', 'UTF8_STRING', 8, Buffer.from('端末'))
    ffi.set(20, 'WM_CLASS', 'STRING', 8, Buffer.from('terminal\0konsole\0'))
    ffi.set(20, '_NET_WM_PID', 'CARDINAL', 32, [1234])
    ffi.set(20, '_NET_WM_STATE', 'ATOM', 32, [])
    backend = new X11EwmhBackend({ sessionType: 'x11', display: ':199' })
  })

  afterEach(async () => {
    await backend.stop()
    vi.unstubAllEnvs()
    expect(ffi.allocated.size).toBe(0)
    expect(ffi.callbacks.size).toBe(0)
    expect(ffi.handler()).toBe(77n)
  })

  it('loads lazily and reuses one display for repeated samples and starts', async () => {
    expect(ffi.load).not.toHaveBeenCalled()
    expect(backend.activeWindow()).toBeNull()
    await Promise.all([backend.start(), backend.start()])

    expect(backend.activeWindow()).toEqual({ caption: '端末', resourceClass: 'konsole', pid: 1234, fullScreen: false })
    expect(backend.activeWindow()?.pid).toBe(1234)
    expect(ffi.native.XOpenDisplay).toHaveBeenCalledTimes(1)
    expect(ffi.native.XOpenDisplay).toHaveBeenCalledWith(':199')
    await backend.stop()
    await backend.stop()
    expect(ffi.native.XCloseDisplay).toHaveBeenCalledTimes(1)
    expect(backend.activeWindow()).toBeNull()
  })

  it('closes the connection when stopped during startup', async () => {
    const starting = backend.start()
    await backend.stop()
    await starting
    expect(backend.activeWindow()).toBeNull()
    expect(ffi.native.XCloseDisplay).toHaveBeenCalledTimes(1)
  })

  it.each(['wayland', 'xwayland', 'unknown', ''])('refuses session %j before loading Xlib', (session) => {
    expect(() => new X11EwmhBackend({ sessionType: session, display: ':199' })).toThrow(X11BackendError)
    expect(ffi.load).not.toHaveBeenCalled()
  })

  it('opens the explicitly selected display when the environment has no DISPLAY', async () => {
    vi.stubEnv('DISPLAY', '')

    await backend.start()

    expect(ffi.native.XOpenDisplay).toHaveBeenCalledWith(':199')
    expect(backend.activeWindow()?.pid).toBe(1234)
  })

  it.each(['', '   ', ':199\0'])('rejects invalid explicit display %j without falling back to the environment', async (display) => {
    backend = new X11EwmhBackend({ sessionType: 'x11', display })

    await expect(backend.start()).rejects.toMatchObject({ reason: 'display-unavailable' })
    expect(ffi.load).not.toHaveBeenCalled()
    expect(ffi.native.XOpenDisplay).not.toHaveBeenCalled()
  })

  it('rejects an unavailable display without calling property functions', async () => {
    ffi.native.XOpenDisplay.mockReturnValue(null)
    await expect(backend.start()).rejects.toMatchObject({ reason: 'display-unavailable' })
    expect(ffi.native.XGetWindowProperty).not.toHaveBeenCalled()
    expect(ffi.native.XCloseDisplay).not.toHaveBeenCalled()
  })

  it('reads fullscreen from the current atom list rather than a cached sample', async () => {
    await backend.start()
    expect(backend.activeWindow()?.fullScreen).toBe(false)
    ffi.set(20, '_NET_WM_STATE', 'ATOM', 32, [987, ffi.atom('_NET_WM_STATE_FULLSCREEN')])
    expect(backend.activeWindow()?.fullScreen).toBe(true)
  })

  it.each([
    ['696e7374616e636500436166e900', 'Caf\u00E9'],
    ['e9006b6f6e736f6c6500', 'konsole'],
  ])('reads Latin-1 WM_CLASS fields %s', async (hex, expected) => {
    ffi.set(20, 'WM_CLASS', 'STRING', 8, Buffer.from(hex, 'hex'))
    await backend.start()
    expect(backend.activeWindow()).toEqual({ caption: '端末', resourceClass: expected, pid: 1234, fullScreen: false })
  })

  it.each([
    { utf8: Buffer.from('Caf\u00E9'), legacy: Buffer.from('different'), expected: 'Caf\u00E9' },
    { utf8: null, legacy: Buffer.from('Caf\u00E9', 'latin1'), expected: 'Caf\u00E9' },
    { utf8: null, legacy: Buffer.from('Caf\u00E9', 'utf8'), expected: 'Caf\u00C3\u00A9' },
  ])('decodes the preferred title using its property encoding %#', async ({ utf8, legacy, expected }) => {
    if (utf8 === null)
      ffi.properties.delete(`20:${ffi.atom('_NET_WM_NAME')}`)
    else
      ffi.set(20, '_NET_WM_NAME', 'UTF8_STRING', 8, utf8)
    ffi.set(20, 'WM_NAME', 'STRING', 8, legacy)
    await backend.start()
    expect(backend.activeWindow()?.caption).toBe(expected)
  })

  it.each([
    ['_NET_WM_NAME', 'UTF8_STRING', 8, Buffer.from([0xFF]), {}],
    ['_NET_WM_NAME', 'UTF8_STRING', 8, Buffer.from('cut'), { remaining: 4 }],
    ['WM_CLASS', 'STRING', 8, Buffer.from('truncated\0'), {}],
    ['_NET_WM_PID', 'CARDINAL', 32, [1, 2], {}],
    ['_NET_WM_PID', 'CARDINAL', 16, [1], {}],
    ['_NET_WM_PID', 'STRING', 32, [1], {}],
    ['_NET_WM_STATE', 'ATOM', 32, [-1], {}],
    ['_NET_WM_STATE', 'ATOM', 32, [1], { count: 2 }],
    ['_NET_WM_STATE', 'ATOM', 32, [1], { status: 1 }],
  ] as const)('returns null for malformed %s %# and frees native data', async (name, type, format, data, overrides) => {
    ffi.set(20, name, type, format, data instanceof Uint8Array ? data : [...data], overrides)
    await backend.start()
    expect(backend.activeWindow()).toBeNull()
  })

  it('returns null when the active window closes during a property read', async () => {
    await backend.start()
    expect(backend.activeWindow()?.pid).toBe(1234)
    ffi.fail('_NET_WM_STATE')
    expect(backend.activeWindow()).toBeNull()
  })

  it.each([{ active: [] }, { active: [0] }, { active: [20, 21] }])('returns null for an absent or non-single active window $active', async ({ active }) => {
    ffi.set(1, '_NET_ACTIVE_WINDOW', 'WINDOW', 32, active)
    await backend.start()
    expect(backend.activeWindow()).toBeNull()
  })

  it('does not reuse the previous sample after the window manager removes its property', async () => {
    await backend.start()
    expect(backend.activeWindow()?.pid).toBe(1234)
    ffi.properties.delete(`1:${ffi.atom('_NET_ACTIVE_WINDOW')}`)
    expect(backend.activeWindow()).toBeNull()
  })
})
