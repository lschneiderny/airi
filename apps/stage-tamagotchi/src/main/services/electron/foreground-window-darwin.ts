import type { ForegroundWindowSample } from '@proj-airi/electron-eventa'

import { Buffer } from 'node:buffer'
import { posix } from 'node:path'

// Native references, prototypes, and output buffers stay in this module.
type NativeRef = unknown

interface Rect {
  readonly origin: { readonly x: number, readonly y: number }
  readonly size: { readonly width: number, readonly height: number }
}

interface NativeBinding {
  objc_getClass: (name: string) => NativeRef
  sel_registerName: (name: string) => NativeRef
  msgSendPointer: (self: NativeRef, op: NativeRef) => NativeRef
  msgSendInt32: (self: NativeRef, op: NativeRef) => number
  msgSendUint8: (self: NativeRef, op: NativeRef) => number
  objc_autoreleasePoolPush: () => NativeRef
  objc_autoreleasePoolPop: (pool: NativeRef) => void
  CFStringGetLength: (value: NativeRef) => number
  CFStringGetCharacters: (value: NativeRef, range: { location: number, length: number }, buffer: Buffer) => void
  CFStringCreateWithCString: (alloc: null, value: string, encoding: number) => NativeRef
  CFRelease: (value: NativeRef) => void
  CFArrayGetCount: (value: NativeRef) => number
  CFArrayGetValueAtIndex: (value: NativeRef, index: number) => NativeRef
  CFDictionaryGetValue: (dict: NativeRef, key: NativeRef) => NativeRef
  CFNumberGetValue: (value: NativeRef, type: number, output: Buffer) => number
  CFBooleanGetValue: (value: NativeRef) => number
  CFGetTypeID: (value: NativeRef) => number
  CFStringGetTypeID: () => number
  CFNumberGetTypeID: () => number
  CFBooleanGetTypeID: () => number
  AXIsProcessTrusted: () => number
  AXUIElementCreateApplication: (pid: number) => NativeRef
  AXUIElementSetMessagingTimeout: (element: NativeRef, seconds: number) => number
  AXUIElementCopyAttributeValue: (element: NativeRef, attribute: NativeRef, value: [NativeRef]) => number
  CGWindowListCopyWindowInfo: (options: number, relativeToWindow: number) => NativeRef
  CGRectMakeWithDictionaryRepresentation: (dict: NativeRef, rect: Buffer) => boolean
  CGSessionCopyCurrentDictionary: () => NativeRef
  CGGetActiveDisplayList: (maxDisplays: number, displays: number[] | null, count: [number]) => number
  CGDisplayBounds: (display: number) => Rect
}

// CoreFoundation CFString.h / CFNumber.h; CoreGraphics CGWindow.h.
const kCFStringEncodingUTF8 = 0x08000100
const kCFNumberSInt64Type = 4
const kCFNumberDoubleType = 13
const kCGWindowListOptionOnScreenOnly = 1
const kCGWindowListExcludeDesktopElements = 16
const kCGNullWindowID = 0

const AX_ERROR = {
  success: 0,
  invalidElement: -25202,
  noValue: -25212,
} as const

function decodeUtf16(buffer: Buffer, units: number): string {
  return buffer.toString('utf16le', 0, units * 2).replace(/[\uD800-\uDBFF]$/u, '')
}

/** Copies a borrowed CFString into JS without taking or releasing ownership. */
function readString(native: NativeBinding, value: NativeRef, maxUnits = native.CFStringGetLength(value)): string {
  const units = Math.min(native.CFStringGetLength(value), maxUnits)
  const buffer = Buffer.alloc(units * 2)
  if (units > 0)
    native.CFStringGetCharacters(value, { location: 0, length: units }, buffer)
  return decodeUtf16(buffer, units)
}

/** An owned CFString. Its pointer never crosses the native boundary. */
class DarwinString {
  #released = false
  readonly #native: NativeBinding
  readonly #value: NativeRef

  constructor(native: NativeBinding, value: NativeRef) {
    this.#native = native
    this.#value = value
  }

  get length(): number {
    this.assertOwned()
    return this.#native.CFStringGetLength(this.#value)
  }

  read(maxUnits = this.length): string {
    this.assertOwned()
    if (!Number.isSafeInteger(maxUnits) || maxUnits < 0)
      throw new RangeError('CFString read length must be a nonnegative safe integer')
    return readString(this.#native, this.#value, maxUnits)
  }

  release(): void {
    this.assertOwned()
    this.#native.CFRelease(this.#value)
    this.#released = true
  }

  private assertOwned(): void {
    if (this.#released)
      throw new ReferenceError('CFString has already been released')
  }
}

/** Decoded native values; no native address, koffi object, or Buffer is exposed. */
export interface DarwinBinding {
  readonly axFrameworkPath: string
  readonly resolvedSymbols: readonly string[]
  readonly isProcessTrusted: () => number
  readonly createString: (value: string) => Pick<DarwinString, 'length' | 'read' | 'release'>
  readonly readSession: () => { readonly onConsole: boolean | null, readonly locked: boolean | null } | null
  readonly withFrontApplication: (read: (application: {
    readonly pid: number
    readonly bundleIdentifier: string | null
    readonly exePath: string | null
    readonly terminated: boolean
  }) => ForegroundWindowSample | null) => ForegroundWindowSample | null
  readonly readDisplays: () => { readonly status: number, readonly displays: readonly { readonly id: number, readonly bounds: Rect }[] }
  readonly readWindows: () => readonly {
    readonly pid: number | null
    readonly layer: number | null
    readonly alpha: number | null
    readonly bounds: Rect | null
  }[] | null
  readonly probeFullscreen: (pid: number) => {
    readonly trusted: number
    readonly status: number
    readonly stage: 'application' | 'window' | 'fullscreen' | 'type'
    readonly value: boolean | null
  }
}

let bindingPromise: Promise<DarwinBinding> | undefined

/** Loads lazily once; framework handles and constant CFStrings live until process exit. */
export async function loadDarwinBinding(): Promise<DarwinBinding> {
  return bindingPromise ??= (async () => {
    const { load, struct, out, pointer } = await import('koffi')
    const objc = load('/usr/lib/libobjc.A.dylib')
    // Loading AppKit registers NSWorkspace and NSRunningApplication with Objective-C.
    load('/System/Library/Frameworks/AppKit.framework/AppKit')
    const cf = load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    const axFrameworkPath = '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices'
    const ax = load(axFrameworkPath)
    const cg = load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    const CFRange = struct({ location: 'long', length: 'long' })
    const CGRect = struct({
      origin: struct({ x: 'double', y: 'double' }),
      size: struct({ width: 'double', height: 'double' }),
    })

    const native: NativeBinding = {
      objc_getClass: objc.func('void *objc_getClass(const char *name)'),
      sel_registerName: objc.func('void *sel_registerName(const char *str)'),
      msgSendPointer: objc.func('void *objc_msgSend(void *self, void *op)'),
      msgSendInt32: objc.func('int32_t objc_msgSend(void *self, void *op)'),
      msgSendUint8: objc.func('uint8_t objc_msgSend(void *self, void *op)'),
      objc_autoreleasePoolPush: objc.func('void *objc_autoreleasePoolPush()'),
      objc_autoreleasePoolPop: objc.func('void objc_autoreleasePoolPop(void *pool)'),
      CFStringGetLength: cf.func('long CFStringGetLength(void *value)'),
      CFStringGetCharacters: cf.func('CFStringGetCharacters', 'void', ['void *', CFRange, out(pointer('uint16_t'))]),
      CFStringCreateWithCString: cf.func('void *CFStringCreateWithCString(void *alloc, const char *cStr, uint32_t encoding)'),
      CFRelease: cf.func('void CFRelease(void *value)'),
      CFArrayGetCount: cf.func('long CFArrayGetCount(void *value)'),
      CFArrayGetValueAtIndex: cf.func('void *CFArrayGetValueAtIndex(void *value, long index)'),
      CFDictionaryGetValue: cf.func('void *CFDictionaryGetValue(void *dict, const void *key)'),
      CFNumberGetValue: cf.func('uint8_t CFNumberGetValue(void *value, long type, _Out_ void *output)'),
      CFBooleanGetValue: cf.func('uint8_t CFBooleanGetValue(void *value)'),
      CFGetTypeID: cf.func('unsigned long CFGetTypeID(void *value)'),
      CFStringGetTypeID: cf.func('unsigned long CFStringGetTypeID()'),
      CFNumberGetTypeID: cf.func('unsigned long CFNumberGetTypeID()'),
      CFBooleanGetTypeID: cf.func('unsigned long CFBooleanGetTypeID()'),
      AXIsProcessTrusted: ax.func('uint8_t AXIsProcessTrusted()'),
      AXUIElementCreateApplication: ax.func('void *AXUIElementCreateApplication(int32_t pid)'),
      AXUIElementSetMessagingTimeout: ax.func('int32_t AXUIElementSetMessagingTimeout(void *element, float seconds)'),
      AXUIElementCopyAttributeValue: ax.func('int32_t AXUIElementCopyAttributeValue(void *element, void *attribute, _Out_ void **value)'),
      CGWindowListCopyWindowInfo: cg.func('void *CGWindowListCopyWindowInfo(uint32_t option, uint32_t relativeToWindow)'),
      CGRectMakeWithDictionaryRepresentation: cg.func('bool CGRectMakeWithDictionaryRepresentation(void *dict, _Out_ void *rect)'),
      CGSessionCopyCurrentDictionary: cg.func('void *CGSessionCopyCurrentDictionary()'),
      CGGetActiveDisplayList: cg.func('int32_t CGGetActiveDisplayList(uint32_t maxDisplays, _Out_ uint32_t *displays, _Out_ uint32_t *count)'),
      CGDisplayBounds: cg.func('CGDisplayBounds', CGRect, ['uint32_t']),
    }

    function createString(value: string): DarwinString {
      const ref = native.CFStringCreateWithCString(null, value, kCFStringEncodingUTF8)
      if (!ref)
        throw new Error('CFStringCreateWithCString returned null')
      return new DarwinString(native, ref)
    }

    // These nine +1 references intentionally live for the process lifetime.
    const keys = {
      AXFocusedWindow: native.CFStringCreateWithCString(null, 'AXFocusedWindow', kCFStringEncodingUTF8),
      AXTitle: native.CFStringCreateWithCString(null, 'AXTitle', kCFStringEncodingUTF8),
      AXFullScreen: native.CFStringCreateWithCString(null, 'AXFullScreen', kCFStringEncodingUTF8),
      kCGWindowLayer: native.CFStringCreateWithCString(null, 'kCGWindowLayer', kCFStringEncodingUTF8),
      kCGWindowOwnerPID: native.CFStringCreateWithCString(null, 'kCGWindowOwnerPID', kCFStringEncodingUTF8),
      kCGWindowBounds: native.CFStringCreateWithCString(null, 'kCGWindowBounds', kCFStringEncodingUTF8),
      kCGWindowAlpha: native.CFStringCreateWithCString(null, 'kCGWindowAlpha', kCFStringEncodingUTF8),
      kCGSSessionOnConsoleKey: native.CFStringCreateWithCString(null, 'kCGSSessionOnConsoleKey', kCFStringEncodingUTF8),
      CGSSessionScreenIsLocked: native.CFStringCreateWithCString(null, 'CGSSessionScreenIsLocked', kCFStringEncodingUTF8),
    }

    function readBoolean(value: NativeRef): boolean | null {
      return value && native.CFGetTypeID(value) === native.CFBooleanGetTypeID()
        ? native.CFBooleanGetValue(value) !== 0
        : null
    }

    function readNumber(value: NativeRef, type: number): number | null {
      if (!value || native.CFGetTypeID(value) !== native.CFNumberGetTypeID())
        return null
      const output = Buffer.alloc(8)
      if (!native.CFNumberGetValue(value, type, output))
        return null
      return type === kCFNumberSInt64Type ? Number(output.readBigInt64LE()) : output.readDoubleLE()
    }

    return {
      axFrameworkPath,
      resolvedSymbols: Object.keys(native),
      isProcessTrusted: () => native.AXIsProcessTrusted(),
      createString,
      readSession() {
        const session = native.CGSessionCopyCurrentDictionary()
        if (!session)
          return null
        try {
          return {
            onConsole: readBoolean(native.CFDictionaryGetValue(session, keys.kCGSSessionOnConsoleKey)),
            locked: readBoolean(native.CFDictionaryGetValue(session, keys.CGSSessionScreenIsLocked)),
          }
        }
        finally {
          native.CFRelease(session)
        }
      },
      withFrontApplication(read) {
        const pool = native.objc_autoreleasePoolPush()
        try {
          const send = (self: NativeRef, selector: string) => native.msgSendPointer(self, native.sel_registerName(selector))
          const workspace = send(native.objc_getClass('NSWorkspace'), 'sharedWorkspace')
          const application = send(workspace, 'frontmostApplication')
          if (!application)
            return null

          function readPath(selector: string): string | null {
            const url = send(application, selector)
            const path = url ? send(url, 'path') : null
            return path ? readString(native, path) || null : null
          }

          // Get-rule objects belong to AppKit/the pool, never to CFRelease.
          return read({
            get pid() {
              return native.msgSendInt32(application, native.sel_registerName('processIdentifier'))
            },
            get bundleIdentifier() {
              const identifier = send(application, 'bundleIdentifier')
              return identifier ? readString(native, identifier) : null
            },
            get exePath() {
              return readPath('bundleURL') ?? readPath('executableURL')
            },
            get terminated() {
              return native.msgSendUint8(application, native.sel_registerName('isTerminated')) !== 0
            },
          })
        }
        finally {
          native.objc_autoreleasePoolPop(pool)
        }
      },
      readDisplays() {
        const count: [number] = [0]
        const status = native.CGGetActiveDisplayList(0, null, count)
        if (status !== 0)
          return { status, displays: [] }
        const ids = Array.from<number>({ length: count[0] }).fill(0)
        const readStatus = native.CGGetActiveDisplayList(ids.length, ids, count)
        return {
          status: readStatus,
          displays: readStatus === 0
            ? ids.slice(0, count[0]).map(id => ({ id, bounds: native.CGDisplayBounds(id) }))
            : [],
        }
      },
      readWindows() {
        const windows = native.CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID)
        if (!windows)
          return null
        try {
          return Array.from({ length: native.CFArrayGetCount(windows) }, (_, index) => {
            const row = native.CFArrayGetValueAtIndex(windows, index)
            const dictionary = native.CFDictionaryGetValue(row, keys.kCGWindowBounds)
            const rect = Buffer.alloc(32)
            const bounds = dictionary && native.CGRectMakeWithDictionaryRepresentation(dictionary, rect)
              ? { origin: { x: rect.readDoubleLE(0), y: rect.readDoubleLE(8) }, size: { width: rect.readDoubleLE(16), height: rect.readDoubleLE(24) } }
              : null
            return {
              pid: readNumber(native.CFDictionaryGetValue(row, keys.kCGWindowOwnerPID), kCFNumberSInt64Type),
              layer: readNumber(native.CFDictionaryGetValue(row, keys.kCGWindowLayer), kCFNumberSInt64Type),
              alpha: readNumber(native.CFDictionaryGetValue(row, keys.kCGWindowAlpha), kCFNumberDoubleType),
              bounds,
            }
          })
        }
        finally {
          native.CFRelease(windows)
        }
      },
      probeFullscreen(pid: number) {
        if (!Number.isInteger(pid) || pid <= 0 || pid > 0x7FFFFFFF)
          throw new RangeError('Accessibility PID must be a positive int32')
        const trusted = native.AXIsProcessTrusted()
        const app = native.AXUIElementCreateApplication(pid)
        if (!app)
          return { trusted, status: AX_ERROR.invalidElement, stage: 'application', value: null }
        const window: [NativeRef] = [null]
        const fullscreen: [NativeRef] = [null]
        try {
          let status = native.AXUIElementSetMessagingTimeout(app, 0.125)
          if (status !== AX_ERROR.success)
            return { trusted, status, stage: 'application', value: null }
          status = native.AXUIElementCopyAttributeValue(app, keys.AXFocusedWindow, window)
          if (status !== AX_ERROR.success || !window[0])
            return { trusted, status: status || AX_ERROR.noValue, stage: 'window', value: null }
          status = native.AXUIElementSetMessagingTimeout(window[0], 0.125)
          if (status !== AX_ERROR.success)
            return { trusted, status, stage: 'window', value: null }
          status = native.AXUIElementCopyAttributeValue(window[0], keys.AXFullScreen, fullscreen)
          if (status !== AX_ERROR.success || !fullscreen[0])
            return { trusted, status: status || AX_ERROR.noValue, stage: 'fullscreen', value: null }
          const value = readBoolean(fullscreen[0])
          return { trusted, status, stage: value === null ? 'type' : 'fullscreen', value }
        }
        finally {
          if (fullscreen[0])
            native.CFRelease(fullscreen[0])
          if (window[0])
            native.CFRelease(window[0])
          native.CFRelease(app)
        }
      },
    }
  })()
}

/** Synchronous reads keep each native lifetime wholly inside one sample. */
export function createDarwinSampler(binding: DarwinBinding, isOwnProcess: (pid: number) => boolean): () => ForegroundWindowSample | null {
  return function sample(): ForegroundWindowSample | null {
    const session = binding.readSession()
    if (!session || session.onConsole === false || session.locked === true)
      return null

    return binding.withFrontApplication((application) => {
      const pid = application.pid
      if (pid <= 0)
        return null
      if (application.bundleIdentifier === 'com.apple.loginwindow' || application.bundleIdentifier === 'com.apple.ScreenSaver.Engine')
        return null

      const exePath = application.exePath
      const ownProcess = isOwnProcess(pid)
      if (application.terminated)
        return null

      return {
        exePath,
        exeName: exePath === null ? null : posix.basename(exePath),
        pid,
        ownProcess,
        title: '',
        busy: 'accepts',
        sampledAtMs: Date.now(),
      }
    })
  }
}
