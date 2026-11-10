import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPointerSampleReporter } from '../../../../../../../packages/electron-vueuse/src/composables/pointer-samples'
import { CoordinateVerifier } from './verification'

const revocationLine = 'linux-desktop: coordinate mismatch revoked verification'

describe('coordinateVerifier', () => {
  let now: number
  let reports: Array<{ geometryVerified?: boolean, cursorVerified?: boolean }>
  let log: ReturnType<typeof vi.fn<(message: string) => void>>
  let verifier: CoordinateVerifier
  const window = {}

  beforeEach(() => {
    now = 1000
    reports = []
    log = vi.fn<(message: string) => void>()
    verifier = new CoordinateVerifier({ report: patch => reports.push(patch), log, now: () => now })
  })

  function grantBoth() {
    verifier.observeGeometry({ sizeMatches: true, displaysKnown: true })
    verifier.observeCursor({ x: 100, y: 100 })
    verifier.observeCursor({ x: 900, y: 500 })
    verifier.observeWindowOrigin(window, { x: 800, y: 400 })
    reports.length = 0
  }

  describe('grant', () => {
    it('grants geometry only for a size match with known displays', () => {
      verifier.observeGeometry({ sizeMatches: false, displaysKnown: true })
      verifier.observeGeometry({ sizeMatches: true, displaysKnown: false })
      expect(reports).toEqual([])
      verifier.observeGeometry({ sizeMatches: true, displaysKnown: true })
      verifier.observeGeometry({ sizeMatches: true, displaysKnown: true })
      expect(reports).toEqual([{ geometryVerified: true }])
      expect(verifier.geometryVerified).toBe(true)
    })

    it('grants the cursor only after geometry and two distinct positions', () => {
      verifier.observeCursor({ x: 1, y: 1 })
      verifier.observeCursor({ x: 1, y: 1 })
      verifier.observeGeometry({ sizeMatches: true, displaysKnown: true })
      expect(verifier.cursorVerified).toBe(false)
      verifier.observeCursor({ x: 2, y: 1 })
      expect(reports).toEqual([{ geometryVerified: true }, { cursorVerified: true }])
    })

    it('grants the cursor at the geometry grant when two positions already arrived', () => {
      verifier.observeCursor({ x: 1, y: 1 })
      verifier.observeCursor({ x: 2, y: 2 })
      verifier.observeGeometry({ sizeMatches: true, displaysKnown: true })
      expect(reports).toEqual([{ geometryVerified: true, cursorVerified: true }])
    })

    it('does not count a lost reading or a repeated position as movement', () => {
      verifier.observeGeometry({ sizeMatches: true, displaysKnown: true })
      verifier.observeCursor({ x: 5, y: 5 })
      verifier.observeCursor(null)
      verifier.observeCursor({ x: 5, y: 5 })
      expect(verifier.cursorVerified).toBe(false)
    })
  })

  describe('silence', () => {
    it('keeps both facts and the last reading for a resting pointer with no samples', () => {
      grantBoth()
      now += 60 * 60 * 1000
      expect(verifier.geometryVerified).toBe(true)
      expect(verifier.cursorVerified).toBe(true)
      expect(reports).toEqual([])
      expect(verifier.comparePointer(window, { clientX: 100, clientY: 100, atMs: now })).toBe('match')
    })

    it('keeps the facts when the cursor stream drops its reading', () => {
      grantBoth()
      verifier.observeCursor(null)
      expect(verifier.cursorVerified).toBe(true)
      expect(verifier.comparePointer(window, { clientX: 100, clientY: 100, atMs: now })).toBe('skipped')
    })
  })

  describe('revoke', () => {
    it('revokes both facts on the second mismatch within ten seconds and logs once', () => {
      grantBoth()
      expect(verifier.comparePointer(window, { clientX: 140, clientY: 100, atMs: now })).toBe('mismatch')
      expect(reports).toEqual([])
      now += 9_999
      expect(verifier.comparePointer(window, { clientX: 140, clientY: 100, atMs: now })).toBe('revoked')
      expect(reports).toEqual([{ geometryVerified: false, cursorVerified: false }])
      expect(log).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledWith(revocationLine)
      expect(verifier.comparePointer(window, { clientX: 140, clientY: 100, atMs: now })).toBe('skipped')
    })

    it('accepts samples within two pixels', () => {
      grantBoth()
      expect(verifier.comparePointer(window, { clientX: 102, clientY: 98, atMs: now })).toBe('match')
      expect(verifier.comparePointer(window, { clientX: 102, clientY: 103, atMs: now })).toBe('mismatch')
    })

    it('accepts a sample that matches a recent cursor and origin pair during a drag', () => {
      grantBoth()
      now += 100
      verifier.observeCursor({ x: 950, y: 500 })
      verifier.observeWindowOrigin(window, { x: 850, y: 400 })
      // The window and cursor moved together; either pairing of recent readings explains the sample.
      expect(verifier.comparePointer(window, { clientX: 100, clientY: 100, atMs: now - 50 })).toBe('match')
    })

    it('ignores readings older than the sample history', () => {
      grantBoth()
      now += 1000
      verifier.observeCursor({ x: 950, y: 500 })
      // The old cursor (900, 500) would match; only the latest and recent ones count.
      expect(verifier.comparePointer(window, { clientX: 100, clientY: 100, atMs: now })).toBe('mismatch')
    })

    it('requires fresh evidence after a revocation', () => {
      grantBoth()
      verifier.comparePointer(window, { clientX: 0, clientY: 0, atMs: now })
      verifier.comparePointer(window, { clientX: 0, clientY: 0, atMs: now })
      reports.length = 0
      verifier.observeCursor({ x: 900, y: 500 })
      verifier.observeCursor({ x: 901, y: 500 })
      expect(verifier.comparePointer(window, { clientX: 101, clientY: 100, atMs: now })).toBe('skipped')
      expect(reports).toEqual([])
      verifier.observeGeometry({ sizeMatches: true, displaysKnown: true })
      expect(reports).toEqual([{ geometryVerified: true, cursorVerified: true }])
    })

    it('still revokes for the two distinct offsets from todo 9', () => {
      grantBoth()
      expect(verifier.comparePointer(window, { clientX: 3, clientY: 4, atMs: now })).toBe('mismatch')
      now += 300
      expect(verifier.comparePointer(window, { clientX: 4, clientY: 5, atMs: now })).toBe('revoked')
      expect(reports).toEqual([{ geometryVerified: false, cursorVerified: false }])
    })

    it('requires two new positions when geometry is proved before cursor recovery', () => {
      grantBoth()
      verifier.comparePointer(window, { clientX: 0, clientY: 0, atMs: now })
      verifier.comparePointer(window, { clientX: 0, clientY: 0, atMs: now })
      reports.length = 0
      verifier.observeGeometry({ sizeMatches: true, displaysKnown: true })
      verifier.observeCursor({ x: 900, y: 500 })
      expect(reports).toEqual([{ geometryVerified: true }])
      verifier.observeCursor({ x: 901, y: 500 })
      expect(reports).toEqual([{ geometryVerified: true }, { cursorVerified: true }])
    })

    it('revokes both facts when the displays stop mapping, without the mismatch log', () => {
      grantBoth()
      verifier.observeGeometry({ sizeMatches: true, displaysKnown: false })
      expect(reports).toEqual([{ geometryVerified: false, cursorVerified: false }])
      expect(log).not.toHaveBeenCalled()
    })

    it('skips samples from a window without an origin', () => {
      grantBoth()
      expect(verifier.comparePointer({}, { clientX: 0, clientY: 0, atMs: now })).toBe('skipped')
      verifier.forgetWindow(window)
      expect(verifier.comparePointer(window, { clientX: 0, clientY: 0, atMs: now })).toBe('skipped')
    })
  })

  describe('gap timeout', () => {
    it('forgets a mismatch after ten seconds without a second one', () => {
      grantBoth()
      expect(verifier.comparePointer(window, { clientX: 0, clientY: 0, atMs: now })).toBe('mismatch')
      now += 10_001
      expect(verifier.comparePointer(window, { clientX: 0, clientY: 0, atMs: now })).toBe('mismatch')
      expect(verifier.geometryVerified).toBe(true)
      expect(reports).toEqual([])
    })

    it('a match does not clear a pending mismatch inside the window', () => {
      grantBoth()
      verifier.comparePointer(window, { clientX: 0, clientY: 0, atMs: now })
      verifier.comparePointer(window, { clientX: 100, clientY: 100, atMs: now })
      now += 5000
      expect(verifier.comparePointer(window, { clientX: 0, clientY: 0, atMs: now })).toBe('revoked')
    })
  })

  it('keeps verification through the recorded XWayland re-entry sequence', () => {
    grantBoth()
    verifier.observeWindowOrigin(window, { x: 0, y: 0 })
    const target = new EventTarget()
    const comparisons: string[] = []
    const snapshot = capabilitiesForHost('linux-xwayland')
    const stop = createPointerSampleReporter({
      target,
      now: () => now,
      wallClock: () => now,
      snapshot: () => ({
        ...snapshot,
        linuxDesktopBackend: 'kwin',
        signals: { ...snapshot.signals, cursorScreenPoint: { kind: 'live' } },
      }),
      report: sample => comparisons.push(verifier.comparePointer(window, sample)),
    })
    // task-32 cross-2 and cross-2-back: the old renderer points repeat at 40097 and 49903.
    // The compositor points on those rows are the corresponding EIS move's destination.
    for (const [at, cursorX, cursorY, clientX, clientY, entry] of [
      [1000, 666, 700, 960, 540, true],
      [1300, 564, 690, 564, 690, false],
      [40097, 716, 700, 564, 690, true],
      [42065, 711, 700, 711, 700, false],
      [42315, 685, 697, 685, 697, false],
      [49903, 1300, 300, 685, 697, true],
    ] as const) {
      now = at
      verifier.observeCursor({ x: cursorX, y: cursorY })
      if (entry)
        target.dispatchEvent(Object.assign(new Event('pointerover'), { relatedTarget: null }))
      target.dispatchEvent(Object.assign(new Event('pointermove'), { clientX, clientY }))
    }
    stop()
    expect(comparisons).toEqual(['match', 'match', 'match'])
    expect(verifier.cursorVerified).toBe(true)
    expect(verifier.geometryVerified).toBe(true)
    expect(log).not.toHaveBeenCalled()
  })

  describe('reset', () => {
    it('clears every fact and history on a compositor restart', () => {
      grantBoth()
      verifier.comparePointer(window, { clientX: 0, clientY: 0, atMs: now })
      verifier.reset()
      expect(reports).toEqual([{ geometryVerified: false, cursorVerified: false }])
      expect(verifier.comparePointer(window, { clientX: 100, clientY: 100, atMs: now })).toBe('skipped')
      verifier.observeGeometry({ sizeMatches: true, displaysKnown: true })
      verifier.observeCursor({ x: 1, y: 1 })
      expect(verifier.cursorVerified).toBe(false)
      verifier.reset()
      verifier.reset()
      expect(reports).toEqual([{ geometryVerified: false, cursorVerified: false }, { geometryVerified: true }, { geometryVerified: false }])
    })
  })
})
