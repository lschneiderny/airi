import type { SignalStatus } from '@proj-airi/stage-shared/host-capabilities'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stageClickThroughGraceMs, watchStageClickThrough } from './click-through-fallback'

const live: SignalStatus = { kind: 'live' }
const emulated: SignalStatus = { kind: 'degraded', reason: 'linux-click-through-emulated' }
const unavailable: SignalStatus = { kind: 'unavailable', reason: 'linux-no-click-through-forward' }

function harness(initial: SignalStatus, options: { bridgeFailed?: boolean } = {}) {
  let status = initial
  let bridgeFailed = options.bridgeFailed ?? false
  let quitting = false
  const listeners = new Set<() => void>()
  const cursorListeners = new Set<(point: { x: number, y: number } | null) => void>()
  const offer = vi.fn()
  const stop = watchStageClickThrough({
    status: () => status,
    bridgeFailed: () => bridgeFailed,
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onCursor: (listener) => {
      cursorListeners.add(listener)
      return () => cursorListeners.delete(listener)
    },
    offer,
    isQuitting: () => quitting,
  })
  const cursor = (point: { x: number, y: number } | null) => cursorListeners.forEach(listener => listener(point))
  return {
    offer,
    stop,
    listeners,
    cursorListeners,
    cursor,
    quit() {
      quitting = true
    },
    set(next: SignalStatus, failed = bridgeFailed) {
      status = next
      bridgeFailed = failed
      listeners.forEach(listener => listener())
    },
    move() {
      cursor({ x: 10, y: 10 })
      cursor({ x: 40, y: 30 })
    },
  }
}

describe('watchStageClickThrough', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('never offers the classic window while forwarded click-through is live', () => {
    const { offer, move } = harness(live)
    move()
    vi.advanceTimersByTime(stageClickThroughGraceMs * 4)
    expect(offer).not.toHaveBeenCalled()
  })

  // Luke, 2026-11-09: "Start the 15 s at first move".
  it('does not offer while the pointer never moves, however long the stage shows', () => {
    const h = harness(unavailable)
    vi.advanceTimersByTime(stageClickThroughGraceMs * 10)
    expect(h.offer).not.toHaveBeenCalled()
  })

  it('does not count the first reported position, or a repeat of it, as a move', () => {
    const h = harness(unavailable)
    h.cursor({ x: 10, y: 10 })
    h.cursor({ x: 10, y: 10 })
    h.cursor(null)
    vi.advanceTimersByTime(stageClickThroughGraceMs * 4)
    expect(h.offer).not.toHaveBeenCalled()
  })

  it('offers once when click-through is still unusable 15 s after the first move', () => {
    const h = harness(unavailable)
    vi.advanceTimersByTime(60_000)
    h.move()
    vi.advanceTimersByTime(stageClickThroughGraceMs - 1)
    expect(h.offer).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(h.offer).toHaveBeenCalledOnce()

    h.move()
    h.set(unavailable)
    vi.advanceTimersByTime(stageClickThroughGraceMs * 4)
    expect(h.offer).toHaveBeenCalledOnce()
  })

  it('does not restart the 15 s on later moves', () => {
    const h = harness(unavailable)
    h.move()
    vi.advanceTimersByTime(stageClickThroughGraceMs - 1000)
    h.cursor({ x: 90, y: 90 })
    vi.advanceTimersByTime(1000)
    expect(h.offer).toHaveBeenCalledOnce()
  })

  it('does not offer when emulated click-through becomes usable within 15 s of the first move', () => {
    const h = harness(unavailable)
    h.move()
    vi.advanceTimersByTime(stageClickThroughGraceMs - 1)
    h.set(emulated)
    vi.advanceTimersByTime(stageClickThroughGraceMs * 4)
    expect(h.offer).not.toHaveBeenCalled()
  })

  it('offers at once when the bridge has already failed as the stage shows, without a move', () => {
    const h = harness(unavailable, { bridgeFailed: true })
    expect(h.offer).toHaveBeenCalledOnce()
  })

  it('offers at once when the bridge fails while the stage shows, without a move', () => {
    const h = harness(unavailable)
    h.set(unavailable, true)
    expect(h.offer).toHaveBeenCalledOnce()
    h.set(unavailable, true)
    expect(h.offer).toHaveBeenCalledOnce()
  })

  it('offers once when a revocation takes usable click-through away, across repeated changes', () => {
    const h = harness(emulated)
    h.set(unavailable)
    expect(h.offer).toHaveBeenCalledOnce()

    h.set(emulated)
    h.set(unavailable)
    vi.advanceTimersByTime(stageClickThroughGraceMs * 4)
    expect(h.offer).toHaveBeenCalledOnce()
  })

  it('treats a degraded status with another reason as unusable', () => {
    const h = harness({ kind: 'degraded', reason: 'linux-capture-audio-unverified' })
    h.move()
    vi.advanceTimersByTime(stageClickThroughGraceMs)
    expect(h.offer).toHaveBeenCalledOnce()
  })

  it('stops listening and offers nothing after it is stopped', () => {
    const h = harness(unavailable)
    h.move()
    h.stop()
    expect(h.listeners.size).toBe(0)
    expect(h.cursorListeners.size).toBe(0)
    vi.advanceTimersByTime(stageClickThroughGraceMs * 4)
    expect(h.offer).not.toHaveBeenCalled()
  })

  it.each(['revocation', 'grace expiry'] as const)('does not offer during shutdown on %s', (trigger) => {
    const h = harness(trigger === 'revocation' ? emulated : unavailable)
    h.move()
    h.quit()
    if (trigger === 'revocation')
      h.set(unavailable, true)
    else
      vi.advanceTimersByTime(stageClickThroughGraceMs)
    expect(h.offer).not.toHaveBeenCalled()
  })

  it('stops listening after it offered', () => {
    const h = harness(emulated)
    h.set(unavailable)
    expect(h.listeners.size).toBe(0)
    expect(h.cursorListeners.size).toBe(0)
  })
})
