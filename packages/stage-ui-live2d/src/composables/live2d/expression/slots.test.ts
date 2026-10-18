import type { SlotLease, SlotLeaseSettings } from './slots'

import { describe, expect, it } from 'vitest'

import { applySpeechEvent, createLease, isLeaseExpired, leaseReleaseAt } from './slots'

const settings: SlotLeaseSettings = { speechGrace: 0.25, unstartedExpiry: 10, holdCap: 15 }

function speechLease(holdSeconds = 1.2, turnId = 'A'): SlotLease {
  return createLease('smile', { turnId, holdSeconds, until: 'speech' }, 0)
}

function apply(lease: SlotLease | null, event: Parameters<typeof applySpeechEvent>[1], now: number, muted = false) {
  return lease && applySpeechEvent(lease, event, now, muted, settings)
}

describe('slot lease lifetimes', () => {
  it('keeps a long speech lease until turn end plus grace', () => {
    let lease = apply(speechLease(), 'clip-start', 0.1)
    lease = apply(lease, 'clip-end', 5)
    lease = apply(lease, 'clip-start', 5.1)
    expect(isLeaseExpired(lease!, 9, false, settings)).toBe(false)
    lease = apply(lease, 'clip-end', 9.8)
    expect(isLeaseExpired(lease!, 9.9, false, settings)).toBe(false)
    lease = apply(lease, 'turn-end', 10)
    expect(leaseReleaseAt(lease!, false, settings)).toBeCloseTo(10.05)
    expect(isLeaseExpired(lease!, 10.04, false, settings)).toBe(false)
    expect(isLeaseExpired(lease!, 10.05, false, settings)).toBe(true)
  })

  it('respects the minimum hold for short speech', () => {
    let lease = apply(speechLease(1.2), 'clip-start', 0.1)
    lease = apply(lease, 'clip-end', 0.5)
    lease = apply(lease, 'turn-end', 0.6)
    expect(leaseReleaseAt(lease!, false, settings)).toBe(1.2)
  })

  it('releases a muted lease after the hold', () => {
    const lease = speechLease(1.2)
    expect(leaseReleaseAt(lease, true, settings)).toBe(1.2)
    expect(isLeaseExpired(lease, 1.19, true, settings)).toBe(false)
    expect(isLeaseExpired(lease, 1.2, true, settings)).toBe(true)
  })

  it('does not release a fresh unstarted lease on an unrelated clip end', () => {
    const lease = speechLease(1.2)
    expect(apply(lease, 'clip-end', 2)).toBe(lease)
    expect(isLeaseExpired(lease, 2, false, settings)).toBe(false)
  })

  it('applies the hold rule once the unstarted expiry passes', () => {
    const lease = speechLease(1.2)
    expect(leaseReleaseAt(lease, false, settings)).toBe(10)
    expect(isLeaseExpired(lease, 9.99, false, settings)).toBe(false)
    expect(isLeaseExpired(lease, 10, false, settings)).toBe(true)
  })

  it('ignores a repeated turn end', () => {
    let lease = apply(speechLease(), 'clip-start', 0.1)
    lease = apply(lease, 'clip-end', 4)
    const first = apply(lease, 'turn-end', 4.1)
    const second = apply(first, 'turn-end', 4.2)
    expect(second).toBe(first)
    expect(leaseReleaseAt(second!, false, settings)).toBeCloseTo(4.25)
  })

  it('releases immediately on clip-stopped', () => {
    const lease = apply(speechLease(), 'clip-start', 0.1)
    expect(apply(lease, 'clip-stopped', 0.2)).toBeNull()
  })

  it('never extends a lease that already ended', () => {
    const lease = apply(speechLease(), 'clip-start', 0.1)
    const ended = apply(lease, 'turn-end', 3)
    expect(apply(ended, 'clip-start', 4)).toBeNull()
    expect(apply(lease, 'clip-start', 15)).toBeNull()
  })

  it('caps every lifetime', () => {
    const lease = apply(speechLease(), 'clip-start', 0.1)
    expect(leaseReleaseAt(lease!, false, settings)).toBe(15)
    expect(leaseReleaseAt(createLease('smile', { holdSeconds: 40, until: 'hold' }, 2), false, settings)).toBe(17)
  })

  it('makes leases without a turn follow the hold rule', () => {
    const lease = createLease('smile', { holdSeconds: 3, until: 'speech' }, 2)
    expect(leaseReleaseAt(lease, false, settings)).toBe(5)
  })
})
