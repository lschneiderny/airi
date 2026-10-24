import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCursorExpiry, CURSOR_EXPIRY_MS } from './cursor-expiry'

describe('createCursorExpiry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('expires a cursor reported under a non-Natural driver after the expiry window', () => {
    const clear = vi.fn()
    const expiry = createCursorExpiry(clear)

    expiry.onCursor('universal', true)
    vi.advanceTimersByTime(CURSOR_EXPIRY_MS - 1)
    expect(clear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('never expires a cursor reported under Natural', () => {
    const clear = vi.fn()
    const expiry = createCursorExpiry(clear)

    expiry.onCursor('natural', true)
    vi.advanceTimersByTime(CURSOR_EXPIRY_MS * 10)
    expect(clear).not.toHaveBeenCalled()
  })

  it('cancels a pending expiry when the driver switches to Natural', () => {
    const clear = vi.fn()
    const expiry = createCursorExpiry(clear)

    expiry.onCursor('universal', true)
    vi.advanceTimersByTime(CURSOR_EXPIRY_MS / 2)
    expiry.onDriverChange('universal', 'natural', true)
    vi.advanceTimersByTime(CURSOR_EXPIRY_MS * 10)
    expect(clear).not.toHaveBeenCalled()
  })

  it('arms the expiry when the driver leaves Natural while a cursor is present', () => {
    const clear = vi.fn()
    const expiry = createCursorExpiry(clear)

    expiry.onCursor('natural', true)
    expiry.onDriverChange('natural', 'universal', true)
    vi.advanceTimersByTime(CURSOR_EXPIRY_MS - 1)
    expect(clear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('does not arm the expiry when the driver leaves Natural without a cursor', () => {
    const clear = vi.fn()
    const expiry = createCursorExpiry(clear)

    expiry.onDriverChange('natural', 'universal', false)
    vi.advanceTimersByTime(CURSOR_EXPIRY_MS * 10)
    expect(clear).not.toHaveBeenCalled()
  })

  it('leaves a pending expiry alone on a driver change between non-Natural drivers', () => {
    const clear = vi.fn()
    const expiry = createCursorExpiry(clear)

    expiry.onCursor('universal', true)
    vi.advanceTimersByTime(CURSOR_EXPIRY_MS / 2)
    expiry.onDriverChange('universal', 'other', true)
    vi.advanceTimersByTime(CURSOR_EXPIRY_MS / 2)
    expect(clear).toHaveBeenCalledTimes(1)
  })
})
