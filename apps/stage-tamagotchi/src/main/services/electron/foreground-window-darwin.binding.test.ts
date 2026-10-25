import process from 'node:process'

import { beforeAll, describe, expect, it } from 'vitest'

import { loadDarwinBinding } from './foreground-window-darwin'

describe.runIf(process.platform === 'darwin')('darwin foreground native binding', () => {
  let binding: Awaited<ReturnType<typeof loadDarwinBinding>>

  beforeAll(async () => {
    binding = await loadDarwinBinding()
    console.info(`AX_FRAMEWORK=${binding.axFrameworkPath}`)
    console.info(`RESOLVED_SYMBOLS=${JSON.stringify(binding.resolvedSymbols)}`)
  })

  it('resolves every native declaration and reads trust without prompting', () => {
    expect([0, 1]).toContain(binding.isProcessTrusted())
  })

  it('reads the console flag from a real session dictionary', (context) => {
    const session = binding.readSession()
    if (session === null) {
      console.info('GUI_SESSION_SKIP: CGSessionCopyCurrentDictionary returned null; session assertion NOT PASSED')
      context.skip()
      return
    }

    expect(typeof session.onConsole).toBe('boolean')
    console.info(`GUI_SESSION=${JSON.stringify(session)}`)
  })

  it('decodes an active display CGRect returned by value', (context) => {
    if (binding.readSession() === null) {
      console.info('GUI_SESSION_SKIP: display assertion NOT PASSED')
      context.skip()
      return
    }

    const result = binding.readDisplays()

    expect(result.status).toBe(0)
    expect(result.displays.length).toBeGreaterThan(0)
    expect(result.displays[0]?.bounds.size.width).toBeGreaterThan(0)
    console.info(`CG_DISPLAY_BOUNDS=${JSON.stringify(result.displays)}`)
  })

  it('round-trips a supplementary character through CFRange and releases the CFString', () => {
    const value = binding.createString('hi \u{1F600}')
    try {
      expect(value.length).toBe(5)
      expect(value.read()).toBe('hi \u{1F600}')
    }
    finally {
      value.release()
    }
  })

  it('drops a high surrogate at a bounded native string read', () => {
    const value = binding.createString('hi \u{1F600}')
    try {
      expect(value.read(4)).toBe('hi ')
    }
    finally {
      value.release()
    }
  })

  it('rejects malformed native read bounds before entering CoreFoundation', () => {
    const value = binding.createString('hi')
    try {
      expect(() => value.read(-1)).toThrow(RangeError)
      expect(() => value.read(Number.NaN)).toThrow(RangeError)
      expect(() => value.read(1.5)).toThrow(RangeError)
    }
    finally {
      value.release()
    }
  })

  it('rejects a stale string after releasing its native ownership', () => {
    const value = binding.createString('hi')
    value.release()

    expect(() => value.read()).toThrow(ReferenceError)
    expect(() => value.release()).toThrow(ReferenceError)
  })

  it('reuses the binding and its lifetime constants across repeated loads', async () => {
    expect(await loadDarwinBinding()).toBe(binding)
  })

  it('decodes the first on-screen window PID and rectangle without reading titles', (context) => {
    if (binding.readSession() === null) {
      console.info('GUI_SESSION_SKIP: window assertion NOT PASSED')
      context.skip()
      return
    }

    const rows = binding.readWindows()
    expect(rows).not.toBeNull()
    expect(rows?.length).toBeGreaterThan(0)
    expect(typeof rows?.[0]?.pid).toBe('number')
    expect(rows?.[0]?.bounds?.size.width).toBeGreaterThan(0)
    expect(rows?.[0]?.bounds?.size.height).toBeGreaterThan(0)
  })

  it('records the AXFullScreen result without disclosing any window title', () => {
    // A manual run sets this to the PID of the Firefox instance it owns.
    // The ordinary regression run probes only its own process, not the user's apps.
    const pid = Number(process.env.AIRI_BINDING_QA_PID ?? process.pid)

    const result = binding.probeFullscreen(pid)

    expect([0, 1]).toContain(result.trusted)
    expect(Number.isInteger(result.status)).toBe(true)
    if (result.status === 0)
      expect(typeof result.value).toBe('boolean')
    console.info(`AX_FULLSCREEN=${JSON.stringify({ pid, ...result })}`)
  })

  it('rejects malformed process IDs before entering Accessibility', () => {
    expect(() => binding.probeFullscreen(Number.NaN)).toThrow(RangeError)
    expect(() => binding.probeFullscreen(-1)).toThrow(RangeError)
    expect(() => binding.probeFullscreen(0x80000000)).toThrow(RangeError)
  })

  it.runIf(Boolean(process.env.AIRI_BINDING_QA_PID))('measures every on-screen row for the owned Firefox PID', (context) => {
    if (binding.readSession() === null) {
      console.info('GUI_SESSION_SKIP: Firefox geometry NOT PASSED')
      context.skip()
      return
    }
    const pid = Number(process.env.AIRI_BINDING_QA_PID)
    const displays = binding.readDisplays()
    const rows = binding.readWindows()?.filter(row => row.pid === pid)

    console.info(`FIREFOX_GEOMETRY=${JSON.stringify({ pid, rows, displays: displays.displays })}`)
    expect(displays.status).toBe(0)
    expect(rows?.length).toBeGreaterThan(0)
  })
})
