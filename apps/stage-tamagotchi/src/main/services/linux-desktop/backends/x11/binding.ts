import { parseAtomArray } from './parsers'

type Pointer = bigint | null

interface NativeBinding {
  readonly XOpenDisplay: (name: string) => Pointer
  readonly XDefaultRootWindow: (display: Pointer) => number
  readonly XInternAtom: (display: Pointer, name: string, onlyIfExists: number) => number
  // This signature mirrors Xlib's ABI, including its five output arguments.
  readonly XGetWindowProperty: (display: Pointer, window: number, property: number, offset: number, length: number, deleteProperty: number, requestedType: number, actualType: [number], format: [number], count: [number], remaining: [number], data: [Pointer]) => number
  readonly XFree: (data: Pointer) => number
  readonly XCloseDisplay: (display: Pointer) => number
  readonly XSetErrorHandler: (handler: Pointer) => Pointer
}

export class X11BackendError extends Error {
  constructor(readonly reason: 'session-unsupported' | 'display-unavailable' | 'property-invalid') {
    super(`X11 backend failed: ${reason}`)
    this.name = 'X11BackendError'
  }
}

type Property
  = | { readonly format: 8, readonly data: Uint8Array }
    | { readonly format: 32, readonly data: readonly number[] }

/** Owns a single display. Native pointers never cross this boundary. */
export class X11Binding {
  readonly root: number
  private readonly atoms = new Map<string, number>()
  private closed = false

  private constructor(
    private readonly koffi: typeof import('koffi'),
    private readonly native: NativeBinding,
    private readonly display: Pointer,
  ) {
    this.root = native.XDefaultRootWindow(display)
  }

  static async open(name: string): Promise<X11Binding> {
    // An empty name lets Xlib consult DISPLAY; a NUL truncates the C string.
    // Require the caller's complete selection before loading any native code.
    if (!name.trim() || name.includes('\0'))
      throw new X11BackendError('display-unavailable')
    const koffi = await import('koffi')
    const library = koffi.load('libX11.so.6')
    const native: NativeBinding = {
      XOpenDisplay: library.func('void *XOpenDisplay(const char *name)'),
      XDefaultRootWindow: library.func('unsigned long XDefaultRootWindow(void *display)'),
      XInternAtom: library.func('unsigned long XInternAtom(void *display, const char *name, int only_if_exists)'),
      XGetWindowProperty: library.func('int XGetWindowProperty(void *display, unsigned long window, unsigned long property, long offset, long length, int delete_property, unsigned long requested_type, _Out_ unsigned long *actual_type, _Out_ int *format, _Out_ unsigned long *count, _Out_ unsigned long *remaining, _Out_ void **data)'),
      XFree: library.func('int XFree(void *data)'),
      XCloseDisplay: library.func('int XCloseDisplay(void *display)'),
      XSetErrorHandler: library.func('void *XSetErrorHandler(void *handler)'),
    }
    const display = native.XOpenDisplay(name)
    if (!display)
      throw new X11BackendError('display-unavailable')
    return new X11Binding(koffi, native, display)
  }

  atom(name: string): number {
    if (this.closed)
      throw new X11BackendError('display-unavailable')
    let atom = this.atoms.get(name)
    if (atom === undefined) {
      atom = this.native.XInternAtom(this.display, name, 0)
      this.atoms.set(name, atom)
    }
    return atom
  }

  property(window: number, name: string, type: string): Property | null {
    const property = this.atom(name)
    const requestedType = this.atom(type)
    const actualType: [number] = [0]
    const format: [number] = [0]
    const count: [number] = [0]
    const remaining: [number] = [0]
    const data: [Pointer] = [null]
    let failed = false
    let previous: Pointer = null
    const errorType = this.koffi.proto('int', ['void *', 'void *'])
    // XGetWindowProperty waits for its reply, including BadWindow when the
    // target closes. Scope the process-global handler to this synchronous call
    // and forward errors from other connections to their original handler.
    const handler = this.koffi.register((display: Pointer, event: Pointer) => {
      if (display === this.display) {
        failed = true
        return 0
      }
      return previous ? this.koffi.call(previous, errorType, display, event) : 0
    }, this.koffi.pointer(errorType))
    try {
      previous = this.native.XSetErrorHandler(handler)
      // 1024 wire longs cap property data at 4096 bytes; reject truncated data.
      const status = this.native.XGetWindowProperty(this.display, window, property, 0, 1024, 0, requestedType, actualType, format, count, remaining, data)
      if (failed || status !== 0 || remaining[0] !== 0)
        throw new X11BackendError('property-invalid')
      if (actualType[0] === 0)
        return null
      if (actualType[0] !== requestedType || !Number.isSafeInteger(count[0]) || count[0] < 0 || count[0] > (format[0] === 32 ? 1024 : 4096) || (!data[0] && count[0] !== 0))
        throw new X11BackendError('property-invalid')
      if (format[0] === 8)
        return { format: 8, data: count[0] === 0 ? new Uint8Array() : new Uint8Array(this.koffi.view(data[0], count[0])).slice() }
      if (format[0] === 32) {
        // On LP64, each format-32 item occupies sizeof(unsigned long), not 4.
        const decoded: unknown = count[0] === 0 ? [] : this.koffi.decode(data[0], 'unsigned long', count[0])
        const atoms = parseAtomArray(decoded)
        if (atoms && atoms.length === count[0])
          return { format: 32, data: atoms }
      }
      throw new X11BackendError('property-invalid')
    }
    finally {
      this.native.XSetErrorHandler(previous)
      this.koffi.unregister(handler)
      if (data[0])
        this.native.XFree(data[0])
    }
  }

  close(): void {
    if (this.closed)
      return
    this.closed = true
    this.native.XCloseDisplay(this.display)
  }
}
