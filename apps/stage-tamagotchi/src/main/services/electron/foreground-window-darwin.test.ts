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

  it('backs off a PID for ten seconds after focused-window timeout', () => {
    desktop.trusted = true
    desktop.focusedStatus = -25204
    const read = createDarwinSampler(binding, () => false)

    const first = read()
    const callsAfterTimeout = desktop.axCalls.length
    vi.advanceTimersByTime(1000)
    const backedOff = read()
    const callsDuringBackoff = desktop.axCalls.length
    vi.advanceTimersByTime(10000)
    desktop.focusedStatus = 0
    const recovered = read()

    expect(first).toMatchObject({ title: '', busy: 'accepts' })
    expect(callsAfterTimeout).toBeGreaterThan(0)
    expect(backedOff?.title).toBe('')
    expect(callsDuringBackoff).toBe(callsAfterTimeout)
    expect(recovered?.title).toBe('Synthetic document')
    expect(native.AXUIElementCreateApplication).toHaveBeenCalledTimes(2)
  })

  it('reads a trusted CFString title without logging or changing geometry busy', () => {
    desktop.trusted = true
    desktop.axTitle = 'Synthetic \u65E5\u672C\u8A9E \u{1F600}'
    desktop.windows = [{ pid: 4321, layer: 0, alpha: 1, bounds: desktop.displays[0] ?? null }]
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample).toMatchObject({ title: desktop.axTitle, busy: 'fullscreen', pid: 4321 })
    for (const log of logs) {
      expect(log).not.toHaveBeenCalled()
      log.mockRestore()
    }
    expect(desktop.axCalls).not.toContain('copy:AXFullScreen')
    expect(native.forbidden).not.toHaveBeenCalled()
  })

  it('returns an empty title with zero AX element calls when untrusted', () => {
    const sample = createDarwinSampler(binding, () => false)()

    expect(sample?.title).toBe('')
    expect(native.AXIsProcessTrusted).toHaveBeenCalledExactlyOnceWith()
    expect(desktop.axCalls).toEqual([])
    expect(native.forbidden).not.toHaveBeenCalled()
  })

  it('backs off when timeout occurs during AXTitle after a successful focused-window lookup', () => {
    desktop.trusted = true
    desktop.titleStatus = -25204
    const read = createDarwinSampler(binding, () => false)

    const first = read()
    vi.advanceTimersByTime(1000)
    const backedOff = read()

    expect(first).toMatchObject({ title: '', busy: 'accepts' })
    expect(backedOff?.title).toBe('')
    expect(desktop.axCalls).toEqual(['createApplication', 'timeout:application', 'copy:AXFocusedWindow', 'timeout:window', 'copy:AXTitle'])
    expect(native.AXUIElementCreateApplication).toHaveBeenCalledTimes(1)
  })

  it('backs off without AXTitle when the budget is exhausted inside AXFocusedWindow', () => {
    desktop.trusted = true
    desktop.focusedMs = 250
    const read = createDarwinSampler(binding, () => false)

    const first = read()
    vi.advanceTimersByTime(1000)
    const backedOff = read()

    expect(first).toMatchObject({ title: '', busy: 'accepts' })
    expect(backedOff?.title).toBe('')
    expect(desktop.axCalls).toEqual(['createApplication', 'timeout:application', 'copy:AXFocusedWindow'])
    expect(native.AXUIElementCreateApplication).toHaveBeenCalledTimes(1)
  })

  it('discards a late AXTitle result and backs off the exhausted shared budget', () => {
    desktop.trusted = true
    desktop.focusedMs = 150
    desktop.titleMs = 100
    const read = createDarwinSampler(binding, () => false)

    const first = read()
    vi.advanceTimersByTime(1000)
    const backedOff = read()

    expect(first?.title).toBe('')
    expect(backedOff?.title).toBe('')
    expect(native.AXUIElementCreateApplication).toHaveBeenCalledTimes(1)
    expect(native.AXUIElementSetMessagingTimeout.mock.calls.map(([, seconds]) => seconds)).toEqual([0.25, 0.1])
  })

  it('clears backoff immediately when the front PID changes and returns', () => {
    desktop.trusted = true
    desktop.focusedStatus = -25204
    const read = createDarwinSampler(binding, () => false)
    expect(read()?.title).toBe('')
    desktop.focusedStatus = 0
    desktop.pid = 77
    desktop.axTitle = 'Synthetic second app'
    expect(read()?.title).toBe('Synthetic second app')
    desktop.pid = 4321
    desktop.axTitle = 'Synthetic original app'

    const returned = read()

    expect(returned?.title).toBe('Synthetic original app')
    expect(native.AXUIElementCreateApplication).toHaveBeenCalledTimes(3)
  })

  it('clears backoff across an own-process switch without querying that process', () => {
    desktop.trusted = true
    desktop.focusedStatus = -25204
    const read = createDarwinSampler(binding, pid => pid === 77)
    expect(read()?.title).toBe('')
    desktop.pid = 77
    expect(read()?.title).toBe('')
    desktop.pid = 4321
    desktop.focusedStatus = 0

    const returned = read()

    expect(returned?.title).toBe('Synthetic document')
    expect(native.AXUIElementCreateApplication).toHaveBeenCalledTimes(2)
  })

  it.each([-25202, -25205, -25211, -25212])('does not back off focused-window AXError %s', (status) => {
    desktop.trusted = true
    desktop.focusedStatus = status
    const read = createDarwinSampler(binding, () => false)
    expect(read()).toMatchObject({ title: '', busy: 'accepts' })
    desktop.focusedStatus = 0

    const recovered = read()

    expect(recovered?.title).toBe('Synthetic document')
    expect(native.AXUIElementCreateApplication).toHaveBeenCalledTimes(2)
  })

  it.each([-25202, -25205, -25211, -25212])('does not back off AXTitle AXError %s', (status) => {
    desktop.trusted = true
    desktop.titleStatus = status
    const read = createDarwinSampler(binding, () => false)
    expect(read()).toMatchObject({ title: '', busy: 'accepts' })
    desktop.titleStatus = 0

    const recovered = read()

    expect(recovered?.title).toBe('Synthetic document')
    expect(native.AXUIElementCreateApplication).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['number', { number: 42 }],
    ['boolean', { value: true }],
    ['dictionary', { dictionary: 'not a CFString' }],
    ['array', []],
  ])('rejects a nonstring AXTitle CF%s before calling CFString functions', (_name, title) => {
    desktop.trusted = true
    desktop.axTitle = title

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample).toMatchObject({ title: '', busy: 'accepts' })
    expect(native.CFStringGetLength).not.toHaveBeenCalledWith(title)
    expect(native.CFStringGetCharacters).not.toHaveBeenCalledWith(title, expect.anything(), expect.anything())
  })

  it('caps a 2000-unit title at 1024 UTF-16 units retaining a complete surrogate pair', () => {
    desktop.trusted = true
    desktop.axTitle = `${'a'.repeat(1022)}\u{1F600}${'b'.repeat(976)}`

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample?.title).toBe(`${'a'.repeat(1022)}\u{1F600}`)
    expect(sample?.title.length).toBe(1024)
  })

  it('drops a high surrogate at the title cap and reuses the sampler buffer', () => {
    desktop.trusted = true
    desktop.axTitle = `${'a'.repeat(1023)}\u{1F600}${'b'.repeat(975)}`
    const read = createDarwinSampler(binding, () => false)
    expect(read()?.title).toBe('a'.repeat(1023))
    desktop.axTitle = 'Short'

    const sample = read()

    expect(sample?.title).toBe('Short')
    const titleBuffers = native.CFStringGetCharacters.mock.calls.filter(([value]) => typeof value === 'object').map(([, , buffer]) => buffer)
    expect(titleBuffers).toHaveLength(2)
    expect(titleBuffers[0]).toBe(titleBuffers[1])
    expect(titleBuffers[0]?.length).toBe(2048)
  })

  it('sets the remaining timeout on both elements before their attribute reads', () => {
    desktop.trusted = true
    desktop.focusedMs = 100
    desktop.titleMs = 20

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample?.title).toBe('Synthetic document')
    expect(desktop.axCalls).toEqual(['createApplication', 'timeout:application', 'copy:AXFocusedWindow', 'timeout:window', 'copy:AXTitle'])
    expect(native.AXUIElementSetMessagingTimeout.mock.calls.map(([element, seconds]) => [element.element, seconds])).toEqual([
      ['application', 0.25],
      ['window', 0.15],
    ])
    expect(performance.now()).toBe(120)
  })

  it('releases every AX Copy and Create reference exactly once across 200 trusted reads', () => {
    desktop.trusted = true
    const read = createDarwinSampler(binding, () => false)

    const samples = Array.from({ length: 200 }, () => read())

    expect(samples.every(sample => sample?.title === 'Synthetic document')).toBe(true)
    expect(native.CFRelease).toHaveBeenCalledTimes(1000)
    const released = native.CFRelease.mock.calls.map(([ref]) => ref)
    expect(new Set(released)).toEqual(new Set(desktop.copies))
    expect(new Set(released).size).toBe(1000)
    expect(native.objc_autoreleasePoolPop).toHaveBeenCalledTimes(200)
  })

  it.each([
    ['application', { axApplication: false }],
    ['window', { axWindow: false }],
    ['title', { axTitle: null }],
    ['empty title', { axTitle: '' }],
  ])('handles a nil or empty AX %s without retaining the previous title', (_name, fields) => {
    desktop.trusted = true
    const read = createDarwinSampler(binding, () => false)
    expect(read()?.title).toBe('Synthetic document')
    Object.assign(desktop, fields)

    const sample = read()

    expect(sample).toMatchObject({ title: '', busy: 'accepts' })
  })

  it('rechecks Accessibility trust without retaining a previous title', () => {
    desktop.trusted = true
    const read = createDarwinSampler(binding, () => false)
    expect(read()?.title).toBe('Synthetic document')
    desktop.trusted = false
    desktop.axCalls.length = 0

    const sample = read()

    expect(sample?.title).toBe('')
    expect(desktop.axCalls).toEqual([])
  })

  it.each(['AXFocusedWindow', 'AXTitle'])('cleans owned resources if %s throws', (attribute) => {
    desktop.trusted = true
    desktop.failAt = attribute

    expect(createDarwinSampler(binding, () => false)).toThrow('AX read failed')

    expect(desktop.owned.size).toBe(0)
    expect(desktop.pools.size).toBe(0)
  })

  it('backs off a hung external lookup using its configured element timeout', () => {
    desktop.trusted = true
    native.AXUIElementCopyAttributeValue.mockImplementationOnce(() => {
      const seconds = native.AXUIElementSetMessagingTimeout.mock.calls.at(-1)?.[1]
      expect(seconds).toBe(0.25)
      vi.advanceTimersByTime((seconds ?? 0) * 1000)
      return -25204
    })
    const read = createDarwinSampler(binding, () => false)

    const sample = read()
    vi.advanceTimersByTime(1000)
    const backedOff = read()

    expect(sample).toMatchObject({ title: '', busy: 'accepts' })
    expect(backedOff?.title).toBe('')
    expect(native.AXUIElementCopyAttributeValue).toHaveBeenCalledTimes(1)
    expect(native.AXUIElementCreateApplication).toHaveBeenCalledTimes(1)
  })

  it('stops before attributes and backs off when setting the element timeout fails', () => {
    desktop.trusted = true
    desktop.timeoutStatus = -25204
    const read = createDarwinSampler(binding, () => false)

    const sample = read()
    const backedOff = read()

    expect(sample?.title).toBe('')
    expect(backedOff?.title).toBe('')
    expect(native.AXUIElementCopyAttributeValue).not.toHaveBeenCalled()
    expect(native.AXUIElementCreateApplication).toHaveBeenCalledTimes(1)
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
    desktop.windows = [{ pid: 4321, layer: 0, alpha: 1, bounds: desktop.displays[0] ?? null }]
    const read = createDarwinSampler(binding, () => false)

    const samples = Array.from({ length: 200 }, () => read())

    expect(samples.every(sample => sample?.pid === 4321 && sample.busy === 'fullscreen')).toBe(true)
    expect(native.CGSessionCopyCurrentDictionary).toHaveBeenCalledTimes(200)
    expect(native.CFRelease.mock.calls).toEqual(desktop.copies.map(ref => [ref]))
    expect(native.CGWindowListCopyWindowInfo).toHaveBeenCalledTimes(200)
    expect(native.CFRelease).toHaveBeenCalledTimes(400)
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

  it.each([
    ['exact cover', 0, 'fullscreen'],
    ['1 pt short', 1, 'fullscreen'],
    ['2 pt short', 2, 'accepts'],
  ] as const)('classifies %s with the one-point tolerance', (_name, short, busy) => {
    desktop.windows = [{
      pid: 4321,
      layer: 0,
      alpha: 1,
      bounds: { origin: { x: 0, y: 0 }, size: { width: 1680 - short, height: 1050 } },
    }]

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample?.busy).toBe(busy)
  })

  it.each([
    ['layer 25', { layer: 25 }],
    ['transparent alpha 0', { alpha: 0 }],
    ['negative alpha', { alpha: -1 }],
    ['non-finite alpha', { alpha: Number.NaN }],
    ['another owner pid', { pid: 99 }],
    ['missing owner pid', { pid: null }],
    ['missing layer', { layer: null }],
    ['missing alpha', { alpha: null }],
    ['missing bounds', { bounds: null }],
    ['non-finite bounds', { bounds: { origin: { x: Number.NaN, y: 0 }, size: { width: 1680, height: 1050 } } }],
    ['Split View half', { bounds: { origin: { x: 0, y: 0 }, size: { width: 840, height: 1050 } } }],
    ['width-only zoom', { bounds: { origin: { x: 0, y: 24 }, size: { width: 1680, height: 1026 } } }],
    ['Stage Manager tile', { bounds: { origin: { x: 100, y: 100 }, size: { width: 1480, height: 850 } } }],
    ['left edge 2 pt short', { bounds: { origin: { x: 2, y: 0 }, size: { width: 1678, height: 1050 } } }],
    ['top edge 2 pt short', { bounds: { origin: { x: 0, y: 2 }, size: { width: 1680, height: 1048 } } }],
    ['bottom edge 2 pt short', { bounds: { origin: { x: 0, y: 0 }, size: { width: 1680, height: 1048 } } }],
    ['oversized by 2 pt', { bounds: { origin: { x: -2, y: 0 }, size: { width: 1684, height: 1050 } } }],
  ] satisfies readonly (readonly [string, Partial<WindowRow>])[])('ignores %s geometry', (_name, fields) => {
    desktop.windows = [{ pid: 4321, layer: 0, alpha: 1, bounds: desktop.displays[0] ?? null, ...fields }]

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample?.busy).toBe('accepts')
  })

  it.each([
    ['com.apple.iWork.Keynote', 'presentation'],
    ['com.microsoft.Powerpoint', 'presentation'],
    ['com.apple.Safari', 'fullscreen'],
  ] as const)('classifies covering %s as %s', (bundleId, busy) => {
    desktop.bundleId = bundleId
    desktop.windows = [{ pid: 4321, layer: 0, alpha: 0.5, bounds: desktop.displays[0] ?? null }]

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample?.busy).toBe(busy)
    expect(native.forbidden).not.toHaveBeenCalled()
  })

  it('covers the second display at a negative origin', () => {
    const bounds = { origin: { x: -1920, y: -200 }, size: { width: 1920, height: 1080 } }
    desktop.displays.push(bounds)
    desktop.windows = [{ pid: 4321, layer: 0, alpha: 1, bounds }]

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample?.busy).toBe('fullscreen')
  })

  it('accepts own-process covering windows without enumerating geometry', () => {
    desktop.windows = [{ pid: 4321, layer: 0, alpha: 1, bounds: desktop.displays[0] ?? null }]

    const sample = createDarwinSampler(binding, () => true)()

    expect(sample?.busy).toBe('accepts')
    expect(native.CGWindowListCopyWindowInfo).not.toHaveBeenCalled()
    expect(native.CGGetActiveDisplayList).not.toHaveBeenCalled()
    expect(native.forbidden).not.toHaveBeenCalled()
  })

  it('reports unknown busy for a null window list without reading displays', () => {
    desktop.windows = null

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample).toMatchObject({ busy: null, pid: 4321 })
    expect(native.CGGetActiveDisplayList).not.toHaveBeenCalled()
    expect(desktop.owned.size).toBe(0)
  })

  it.each([
    ['count', { displayCountStatus: 1000 }, 1],
    ['list', { displayListStatus: 1000 }, 2],
  ] as const)('reports unknown busy when the display %s query fails despite a covering window', (_pass, fields, calls) => {
    desktop.windows = [{ pid: 4321, layer: 0, alpha: 1, bounds: desktop.displays[0] ?? null }]
    Object.assign(desktop, fields)

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample).toMatchObject({ busy: null, pid: 4321 })
    expect(native.CGGetActiveDisplayList).toHaveBeenCalledTimes(calls)
    expect(native.CGDisplayBounds).not.toHaveBeenCalled()
  })

  it('accepts when display enumeration succeeds with no active displays', () => {
    desktop.windows = [{ pid: 4321, layer: 0, alpha: 1, bounds: desktop.displays[0] ?? null }]
    desktop.displays = []

    const sample = createDarwinSampler(binding, () => false)()

    expect(sample).toMatchObject({ busy: 'accepts', pid: 4321 })
    expect(native.CGGetActiveDisplayList).toHaveBeenCalledTimes(2)
    expect(native.CGDisplayBounds).not.toHaveBeenCalled()
  })

  it('releases the window list and pool when bounds decoding throws', () => {
    desktop.windows = [{ pid: 4321, layer: 0, alpha: 1, bounds: desktop.displays[0] ?? null }]
    desktop.failAt = 'bounds'

    expect(createDarwinSampler(binding, () => false)).toThrow('bounds read failed')

    expect(native.CFRelease.mock.calls).toEqual(desktop.copies.map(ref => [ref]))
    expect(desktop.owned.size).toBe(0)
    expect(desktop.pools.size).toBe(0)
  })

  it('rechecks window geometry and presentation identity without stale state', () => {
    const read = createDarwinSampler(binding, () => false)
    desktop.windows = [{ pid: 4321, layer: 0, alpha: 1, bounds: desktop.displays[0] ?? null }]
    expect(read()?.busy).toBe('fullscreen')
    desktop.bundleId = 'com.apple.iWork.Keynote'
    expect(read()?.busy).toBe('presentation')
    desktop.windows = []
    expect(read()?.busy).toBe('accepts')
    desktop.windows = null
    expect(read()?.busy).toBeNull()
    desktop.windows = []
    expect(read()?.busy).toBe('accepts')
  })
})
