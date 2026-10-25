import type { Buffer } from 'node:buffer'

import type { DarwinBinding } from './foreground-window-darwin'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDarwinSampler, loadDarwinBinding } from './foreground-window-darwin'

type WindowRow = NonNullable<ReturnType<DarwinBinding['readWindows']>>[number]
type Rect = NonNullable<WindowRow['bounds']>

interface Desktop {
  session: boolean
  onConsole: boolean
  locked: boolean | null
  frontApp: boolean
  pid: number
  bundleId: string | null
  bundlePath: string | null
  executablePath: string | null
  terminated: boolean
  failAt: string
  owned: Set<unknown>
  copies: unknown[]
  pools: Set<unknown>
  calls: string[]
  windows: WindowRow[] | null
  displays: Rect[]
  displayCountStatus: number
  displayListStatus: number
  trusted: boolean
  axApplication: boolean
  axWindow: boolean
  axTitle: unknown
  focusedStatus: number
  titleStatus: number
  timeoutStatus: number
  focusedMs: number
  titleMs: number
  axCalls: string[]
}

const desktop = vi.hoisted((): Desktop => ({
  session: true,
  onConsole: true,
  locked: false,
  frontApp: true,
  pid: 4321,
  bundleId: 'com.apple.Safari',
  bundlePath: '/Applications/Safari.app',
  executablePath: '/Applications/Safari.app/Contents/MacOS/Safari',
  terminated: false,
  failAt: '',
  owned: new Set<unknown>(),
  copies: [],
  pools: new Set<unknown>(),
  calls: [],
  windows: [],
  displays: [],
  displayCountStatus: 0,
  displayListStatus: 0,
  trusted: false,
  axApplication: true,
  axWindow: true,
  axTitle: 'Synthetic document',
  focusedStatus: 0,
  titleStatus: 0,
  timeoutStatus: 0,
  focusedMs: 0,
  titleMs: 0,
  axCalls: [],
}))

const native = vi.hoisted(() => ({
  CGSessionCopyCurrentDictionary: vi.fn(() => {
    if (!desktop.session)
      return null
    const session = Symbol('session')
    desktop.owned.add(session)
    desktop.copies.push(session)
    return session
  }),
  CFDictionaryGetValue: vi.fn((dictionary: unknown, key: string) => {
    if (desktop.failAt === 'session')
      throw new Error('session read failed')
    if (typeof dictionary === 'object' && dictionary !== null && 'pid' in dictionary) {
      const row = desktop.windows?.find(row => row === dictionary)
      switch (key) {
        case 'kCGWindowOwnerPID': return row?.pid == null ? null : { number: row.pid }
        case 'kCGWindowLayer': return row?.layer == null ? null : { number: row.layer }
        case 'kCGWindowAlpha': return row?.alpha == null ? null : { number: row.alpha }
        case 'kCGWindowBounds': return row?.bounds
      }
    }
    const value = key === 'kCGSSessionOnConsoleKey' ? desktop.onConsole : desktop.locked
    // kCFBooleanFalse is a non-null reference, not the JavaScript false value.
    return value === null ? null : { value }
  }),
  CFGetTypeID: vi.fn((value: unknown) => {
    if (typeof value === 'string')
      return 3
    if (typeof value === 'object' && value !== null) {
      if ('value' in value)
        return 1
      if ('string' in value)
        return 3
      if ('number' in value)
        return 2
    }
    return 4
  }),
  CFStringGetTypeID: vi.fn(() => 3),
  CFBooleanGetTypeID: vi.fn(() => 1),
  CFNumberGetTypeID: vi.fn(() => 2),
  CFNumberGetValue: vi.fn((value: { number: number }, type: number, buffer: Buffer) => {
    if (type === 4)
      buffer.writeBigInt64LE(BigInt(value.number))
    else
      buffer.writeDoubleLE(value.number)
    return 1
  }),
  CFBooleanGetValue: vi.fn((ref: { value: boolean }) => Number(ref.value)),
  CFStringCreateWithCString: vi.fn((_alloc: null, value: string) => value),
  CFStringGetLength: vi.fn((value: unknown) => {
    if (typeof value === 'string')
      return value.length
    if (typeof value === 'object' && value !== null && 'string' in value && typeof value.string === 'string')
      return value.string.length
    throw new TypeError('CFString required')
  }),
  CFStringGetCharacters: vi.fn((value: unknown, range: { location: number, length: number }, buffer: Buffer) => {
    expect(desktop.pools.size).toBe(1)
    const string = typeof value === 'string' ? value : typeof value === 'object' && value !== null && 'string' in value ? value.string : null
    if (typeof string !== 'string')
      throw new TypeError('CFString required')
    buffer.write(string.slice(range.location, range.location + range.length), 0, 'utf16le')
  }),
  CFRelease: vi.fn((value: unknown) => {
    if (!desktop.owned.delete(value))
      throw new Error('released null, borrowed, or already released reference')
  }),
  objc_autoreleasePoolPush: vi.fn(() => {
    const pool = Symbol('pool')
    desktop.pools.add(pool)
    return pool
  }),
  objc_autoreleasePoolPop: vi.fn((pool: unknown) => {
    if (!desktop.pools.delete(pool))
      throw new Error('popped unknown pool')
  }),
  objc_getClass: vi.fn((name: string) => name),
  sel_registerName: vi.fn((name: string) => name),
  msgSendPointer: vi.fn((self: unknown, op: string) => {
    expect(desktop.pools.size).toBe(1)
    desktop.calls.push(op)
    if (desktop.failAt === op)
      throw new Error('Objective-C read failed')
    switch (op) {
      case 'sharedWorkspace':
        expect(self).toBe('NSWorkspace')
        return 'workspace'
      case 'frontmostApplication':
        expect(self).toBe('workspace')
        return desktop.frontApp ? 'app' : null
      case 'bundleIdentifier':
        expect(self).toBe('app')
        return desktop.bundleId
      case 'bundleURL':
        expect(self).toBe('app')
        return desktop.bundlePath ? 'bundle-url' : null
      case 'executableURL':
        expect(self).toBe('app')
        return desktop.executablePath ? 'exe-url' : null
      case 'path': return self === 'bundle-url' ? desktop.bundlePath : desktop.executablePath
      default: throw new Error(`unexpected selector: ${op}`)
    }
  }),
  msgSendInt32: vi.fn((self: unknown, op: string) => {
    expect(self).toBe('app')
    expect(op).toBe('processIdentifier')
    return desktop.pid
  }),
  msgSendUint8: vi.fn((self: unknown, op: string) => {
    expect(self).toBe('app')
    expect(op).toBe('isTerminated')
    return Number(desktop.terminated)
  }),
  CGWindowListCopyWindowInfo: vi.fn((options: number, relativeToWindow: number) => {
    expect(options).toBe(17)
    expect(relativeToWindow).toBe(0)
    if (desktop.windows === null)
      return null
    const windows = Symbol('windows')
    desktop.owned.add(windows)
    desktop.copies.push(windows)
    return windows
  }),
  CFArrayGetCount: vi.fn(() => desktop.windows?.length ?? 0),
  CFArrayGetValueAtIndex: vi.fn((_array: unknown, index: number) => desktop.windows?.[index]),
  CGRectMakeWithDictionaryRepresentation: vi.fn((rect: Rect, buffer: Buffer) => {
    if (desktop.failAt === 'bounds')
      throw new Error('bounds read failed')
    buffer.writeDoubleLE(rect.origin.x, 0)
    buffer.writeDoubleLE(rect.origin.y, 8)
    buffer.writeDoubleLE(rect.size.width, 16)
    buffer.writeDoubleLE(rect.size.height, 24)
    return true
  }),
  CGGetActiveDisplayList: vi.fn((max: number, ids: number[] | null, count: [number]) => {
    count[0] = desktop.displays.length
    if (ids) {
      for (let index = 0; index < max; index++)
        ids[index] = index + 1
    }
    return ids === null ? desktop.displayCountStatus : desktop.displayListStatus
  }),
  CGDisplayBounds: vi.fn((id: number) => desktop.displays[id - 1]),
  AXIsProcessTrusted: vi.fn(() => Number(desktop.trusted)),
  AXUIElementCreateApplication: vi.fn((pid: number) => {
    desktop.axCalls.push('createApplication')
    expect(pid).toBe(desktop.pid)
    if (!desktop.axApplication)
      return null
    const app = { element: 'application' }
    desktop.owned.add(app)
    desktop.copies.push(app)
    return app
  }),
  AXUIElementSetMessagingTimeout: vi.fn((element: { element: string }, seconds: number) => {
    desktop.axCalls.push(`timeout:${element.element}`)
    expect(seconds).toBeGreaterThan(0)
    expect(seconds).toBeLessThanOrEqual(0.25)
    return desktop.timeoutStatus
  }),
  AXUIElementCopyAttributeValue: vi.fn((element: { element: string }, attribute: string, output: [unknown]) => {
    desktop.axCalls.push(`copy:${attribute}`)
    if (desktop.failAt === attribute)
      throw new Error('AX read failed')
    const focused = attribute === 'AXFocusedWindow'
    expect(attribute).toBe(focused ? 'AXFocusedWindow' : 'AXTitle')
    expect(element.element).toBe(focused ? 'application' : 'window')
    vi.advanceTimersByTime(focused ? desktop.focusedMs : desktop.titleMs)
    const status = focused ? desktop.focusedStatus : desktop.titleStatus
    const value = focused
      ? desktop.axWindow ? { element: 'window' } : null
      : typeof desktop.axTitle === 'string' ? { string: desktop.axTitle } : desktop.axTitle
    if (value !== null) {
      desktop.owned.add(value)
      desktop.copies.push(value)
    }
    output[0] = value
    return status
  }),
  forbidden: vi.fn(() => {
    throw new Error('unexpected window, display, or AX call')
  }),
}))

vi.mock('koffi', () => ({
  struct: (value: unknown) => value,
  pointer: (value: unknown) => value,
  out: (value: unknown) => value,
  load: () => ({
    func: (definition: string) => {
      if (definition.includes('objc_msgSend'))
        return definition.startsWith('int32_t') ? native.msgSendInt32 : definition.startsWith('uint8_t') ? native.msgSendUint8 : native.msgSendPointer
      const name = /\b(\w+)\(/u.exec(definition)?.[1] ?? definition
      return Object.entries(native).find(([key]) => key === name)?.[1] ?? native.forbidden
    },
  }),
}))

describe('darwin foreground sampler', () => {
  let binding: DarwinBinding

  beforeAll(async () => {
    binding = await loadDarwinBinding()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date', 'performance'] })
    vi.setSystemTime(Date.UTC(2026, 9, 25, 12))
    Object.assign(desktop, {
      session: true,
      onConsole: true,
      locked: false,
      frontApp: true,
      pid: 4321,
      bundleId: 'com.apple.Safari',
      bundlePath: '/Applications/Safari.app',
      executablePath: '/Applications/Safari.app/Contents/MacOS/Safari',
      terminated: false,
      failAt: '',
      windows: [],
      displays: [{ origin: { x: 0, y: 0 }, size: { width: 1680, height: 1050 } }],
      displayCountStatus: 0,
      displayListStatus: 0,
      trusted: false,
      axApplication: true,
      axWindow: true,
      axTitle: 'Synthetic document',
      focusedStatus: 0,
      titleStatus: 0,
      timeoutStatus: 0,
      focusedMs: 0,
      titleMs: 0,
    })
    desktop.owned.clear()
    desktop.copies.length = 0
    desktop.pools.clear()
    desktop.calls.length = 0
    desktop.axCalls.length = 0
  })

  afterEach(() => {
    expect(desktop.owned.size).toBe(0)
    expect(desktop.pools.size).toBe(0)
    vi.useRealTimers()
  })

  it('returns null for a locked session before touching Objective-C', () => {
    desktop.locked = true

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample).toBeNull()
    expect(native.objc_autoreleasePoolPush).not.toHaveBeenCalled()
    expect(desktop.owned.size).toBe(0)
  })

  it('samples the ordinary Safari bundle synchronously with the exact timestamp', () => {
    const sample = createDarwinSampler(binding, () => false)()

    expect(sample).toEqual({
      exePath: '/Applications/Safari.app',
      exeName: 'Safari.app',
      pid: 4321,
      ownProcess: false,
      title: '',
      busy: 'accepts',
      sampledAtMs: Date.now(),
    })
    expect(desktop.pools.size).toBe(0)
    expect(desktop.owned.size).toBe(0)
    expect(desktop.calls).not.toContain('executableURL')
  })

  it.each([
    ['a null session dictionary', { session: false }],
    ['an off-console session', { onConsole: false }],
    ['a nil frontmost application', { frontApp: false }],
    ['pid zero', { pid: 0 }],
    ['a negative pid', { pid: -1 }],
    ['the loginwindow bundle', { bundleId: 'com.apple.loginwindow' }],
    ['the screen-saver bundle', { bundleId: 'com.apple.ScreenSaver.Engine' }],
    ['an application that terminated mid-read', { terminated: true }],
  ])('returns null for %s', (_name, fields) => {
    Object.assign(desktop, fields)

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample).toBeNull()
    expect(desktop.owned.size).toBe(0)
    expect(desktop.pools.size).toBe(0)
    expect(native.CFRelease).not.toHaveBeenCalledWith(null)
  })

  it.each([false, null])('samples an unlocked session when the lock flag is %s', (locked) => {
    desktop.locked = locked

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample?.pid).toBe(4321)
  })

  it('uses the executable URL for a bundle-less process', () => {
    desktop.bundleId = null
    desktop.bundlePath = null
    desktop.executablePath = '/usr/local/bin/editor'

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample).toMatchObject({ exePath: '/usr/local/bin/editor', exeName: 'editor' })
  })

  it('preserves a sample with unknown identity when both URLs are nil', () => {
    desktop.bundlePath = null
    desktop.executablePath = null

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample).toMatchObject({ pid: 4321, exePath: null, exeName: null })
  })

  it('copies Unicode bundle paths before draining the autorelease pool', () => {
    desktop.bundlePath = '/Applications/\u65E5\u672C\u8A9E \u{1F600}.app'

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample).toMatchObject({ exePath: desktop.bundlePath, exeName: '\u65E5\u672C\u8A9E \u{1F600}.app' })
    expect(desktop.pools.size).toBe(0)
  })

  it('skips window-list and all AX calls for an own-process pid', () => {
    const isOwnProcess = vi.fn((pid: number) => pid === 4321)

    const sample = createDarwinSampler(binding, isOwnProcess)()

    expect(sample).toMatchObject({ pid: 4321, ownProcess: true, title: '', busy: 'accepts' })
    expect(isOwnProcess).toHaveBeenCalledExactlyOnceWith(4321)
    expect(native.forbidden).not.toHaveBeenCalled()
    expect(native.CGWindowListCopyWindowInfo).not.toHaveBeenCalled()
    expect(native.CGGetActiveDisplayList).not.toHaveBeenCalled()
  })

  it('balances copied references and autorelease pools across 200 reads', () => {
    const read = createDarwinSampler(binding, () => false)

    const samples = Array.from({ length: 200 }, () => read())

    expect(samples.every(sample => sample?.pid === 4321 && sample.busy === 'accepts')).toBe(true)
    expect(native.CGSessionCopyCurrentDictionary).toHaveBeenCalledTimes(200)
    expect(native.CFRelease.mock.calls).toEqual(desktop.copies.map(ref => [ref]))
    expect(native.CGWindowListCopyWindowInfo).not.toHaveBeenCalled()
    expect(native.CFRelease).toHaveBeenCalledTimes(200)
    expect(desktop.owned.size).toBe(0)
    expect(native.objc_autoreleasePoolPush).toHaveBeenCalledTimes(200)
    expect(native.objc_autoreleasePoolPop.mock.calls).toEqual(native.objc_autoreleasePoolPush.mock.results.map(result => [result.value]))
    expect(desktop.pools.size).toBe(0)
  })

  it.each(['session', 'frontmostApplication', 'bundleIdentifier', 'path'])('cleans owned resources when %s throws', (failAt) => {
    desktop.failAt = failAt
    const read = createDarwinSampler(binding, () => false)

    expect(read).toThrow(failAt === 'session' ? 'session read failed' : 'Objective-C read failed')

    expect(desktop.owned.size).toBe(0)
    expect(desktop.pools.size).toBe(0)
  })

  it('drains the autorelease pool if the own-process predicate throws', () => {
    const read = createDarwinSampler(binding, () => {
      throw new Error('predicate failed')
    })

    expect(read).toThrow('predicate failed')

    expect(desktop.owned.size).toBe(0)
    expect(desktop.pools.size).toBe(0)
  })

  it('rechecks session, identity and own-process state on each synchronous read', () => {
    let ownPid = 4321
    const read = createDarwinSampler(binding, pid => pid === ownPid)

    const first = read()
    desktop.locked = true
    const locked = read()
    desktop.locked = false
    ownPid = 77
    desktop.pid = 77
    desktop.bundlePath = '/Applications/Other.app'
    const next = read()

    expect(first).toMatchObject({ pid: 4321, ownProcess: true, exeName: 'Safari.app' })
    expect(locked).toBeNull()
    expect(next).toMatchObject({ pid: 77, ownProcess: true, exeName: 'Other.app' })
    expect(desktop.owned.size).toBe(0)
    expect(desktop.pools.size).toBe(0)
  })
})
