import type { SelfObservation } from '@proj-airi/stage-shared/situation'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSpeechBusContext } from '../services/speech/bus'
import { selfReportOf, useStageSelfStore } from './self'
import { situationSelfObservedEvent } from './situation/self-bus'

const T0 = Date.UTC(2026, 10, 12, 9, 0, 0)

/** Collects forwarded self observations; `next(count)` resolves once `count` arrived and rejects after 5 s. */
function observeForwarded() {
  const received: SelfObservation[] = []
  const waiters: Array<{ count: number, resolve: () => void }> = []
  const stop = getSpeechBusContext().on(situationSelfObservedEvent, ({ body }) => {
    if (body)
      received.push(body)
    for (const waiter of waiters.filter(waiter => received.length >= waiter.count))
      waiter.resolve()
  })
  function next(count: number) {
    if (received.length >= count)
      return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      waiters.push({ count, resolve })
      AbortSignal.timeout(5000).addEventListener('abort', () => reject(new Error(`expected ${count} forwarded self reports, got ${received.length}`)))
    })
  }
  return { received, next, stop }
}

describe('selfReportOf', () => {
  it('passes an idle activity through with its phase', () => {
    expect(selfReportOf({ behaviour: 'yawn', phase: 'start' })).toEqual({ activity: 'yawn', phase: 'start' })
    expect(selfReportOf({ behaviour: 'sleep', phase: 'end' })).toEqual({ activity: 'sleep', phase: 'end' })
  })

  it('tells a reach-out she decided against once, as a finished moment, and never the wait before it', () => {
    expect(selfReportOf({ behaviour: 'about-to-speak', phase: 'start' })).toBeNull()
    expect(selfReportOf({ behaviour: 'about-to-speak', phase: 'end' })).toBeNull()
    expect(selfReportOf({ behaviour: 'let-go', phase: 'start' })).toEqual({ activity: 'held-back', phase: 'end' })
    expect(selfReportOf({ behaviour: 'let-go', phase: 'end' })).toBeNull()
  })
})

describe('stage self store', () => {
  let forwarded: ReturnType<typeof observeForwarded>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    forwarded = observeForwarded()
  })

  afterEach(() => {
    forwarded.stop()
    vi.useRealTimers()
  })

  it('forwards idle behaviours and body reports to the situation leader with the time', async () => {
    const store = useStageSelfStore()

    store.idle({ behaviour: 'about-to-speak', phase: 'start' })
    store.idle({ behaviour: 'stretch', phase: 'start' })
    store.report({ activity: 'clip', phase: 'start', label: 'wave' })
    await forwarded.next(2)

    expect(forwarded.received).toEqual([
      { kind: 'self', activity: 'stretch', phase: 'start', atMs: T0 },
      { kind: 'self', activity: 'clip', phase: 'start', label: 'wave', atMs: T0 },
    ])
  })
})
