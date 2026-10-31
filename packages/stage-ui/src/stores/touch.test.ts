import type { TouchObservation } from '@proj-airi/stage-shared/situation'

import type { StagePerformanceConductor } from '../composables/performance/use-stage-performance-conductor'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSpeechBusContext } from '../services/speech/bus'
import { situationTouchObservedEvent } from './situation/touch-bus'
import { useStageTouchStore } from './touch'

const T0 = Date.UTC(2026, 9, 31, 9, 0, 0)

/** Collects forwarded touch observations; `next(count)` resolves once `count` arrived and rejects after 5 s. */
function observeForwarded() {
  const received: TouchObservation[] = []
  const waiters: Array<{ count: number, resolve: () => void }> = []
  const stop = getSpeechBusContext().on(situationTouchObservedEvent, ({ body }) => {
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
      AbortSignal.timeout(5000).addEventListener('abort', () => reject(new Error(`expected ${count} forwarded touches, got ${received.length}`)))
    })
  }
  return { received, next, stop }
}

describe('stage touch store', () => {
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

  it('sends a pet start to the conductor and forwards no observation for it', async () => {
    const conductor = { touch: vi.fn<StagePerformanceConductor['touch']>() }
    const store = useStageTouchStore()

    store.touch({ kind: 'pet-start' }, conductor)
    // A later poke is the completion signal: once it arrived, an observation for the pet start would have too.
    store.touch({ kind: 'poke', region: 'head', x: 0, y: 0 }, conductor)
    await forwarded.next(1)

    expect(conductor.touch.mock.calls[0]).toEqual([{ touch: 'pet-start', region: 'head' }])
    expect(forwarded.received).toEqual([{ kind: 'touch', gesture: 'poke', region: 'head', atMs: T0 }])
  })

  it('maps a finished pet to a head pet signal in seconds and forwards it stamped with the current time', async () => {
    const conductor = { touch: vi.fn<StagePerformanceConductor['touch']>() }

    useStageTouchStore().touch({ kind: 'pet-end', durationMs: 4200 }, conductor)
    await forwarded.next(1)

    expect(conductor.touch.mock.calls).toEqual([[{ touch: 'pet-end', region: 'head', durationSeconds: 4.2 }]])
    expect(forwarded.received).toEqual([{ kind: 'touch', gesture: 'pet', region: 'head', atMs: T0, durationMs: 4200 }])
  })

  it('keeps the poke region and stamps each forwarded poke with its own time', async () => {
    const conductor = { touch: vi.fn<StagePerformanceConductor['touch']>() }
    const store = useStageTouchStore()

    store.touch({ kind: 'poke', region: 'body', x: 0.2, y: 0.4 }, conductor)
    vi.setSystemTime(T0 + 1500)
    store.touch({ kind: 'poke', region: 'head', x: 0, y: 0 }, conductor)
    await forwarded.next(2)

    expect(conductor.touch.mock.calls).toEqual([[{ touch: 'poke', region: 'body' }], [{ touch: 'poke', region: 'head' }]])
    expect(forwarded.received).toEqual([
      { kind: 'touch', gesture: 'poke', region: 'body', atMs: T0 },
      { kind: 'touch', gesture: 'poke', region: 'head', atMs: T0 + 1500 },
    ])
  })
})
