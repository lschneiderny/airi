import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KeepAboveVerifier, LatestValueActuator } from './actuators'

describe('keepAboveVerifier', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const report = vi.fn<(verified: boolean) => void>()
    return { report, verifier: new KeepAboveVerifier({ report }) }
  }

  it('verifies when a push shows the requested value after the actuator ran', () => {
    const { report, verifier } = setup()
    verifier.expect('{w1}', true)
    verifier.applied('{w1}', true, [{ id: '{w1}', keepAbove: false }])
    expect(report).not.toHaveBeenCalled()
    verifier.observe([{ id: '{w1}', keepAbove: true }])
    expect(report).toHaveBeenCalledExactlyOnceWith(true)
    vi.advanceTimersByTime(2000)
    expect(report).toHaveBeenCalledOnce()
  })

  it('verifies at once when the current snapshot already shows the requested value', () => {
    const { report, verifier } = setup()
    verifier.expect('{w1}', true)
    verifier.applied('{w1}', true, [{ id: '{w1}', keepAbove: true }])
    expect(report).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('reports a mismatch when no push shows the requested value within 1 s', () => {
    const { report, verifier } = setup()
    verifier.expect('{w1}', true)
    verifier.applied('{w1}', true, [{ id: '{w1}', keepAbove: false }])
    verifier.observe([{ id: '{w1}', keepAbove: false }])
    vi.advanceTimersByTime(999)
    expect(report).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(report).toHaveBeenCalledExactlyOnceWith(false)
  })

  it.each([true, false])('never verifies an entry without keepAbove and reports false after 1 s (requested %s)', (on) => {
    const { report, verifier } = setup()
    verifier.expect('{w1}', on)
    verifier.applied('{w1}', on, [{ id: '{w1}' }])
    verifier.observe([{ id: '{w1}' }])
    vi.advanceTimersByTime(999)
    expect(report).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(report).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('reports false when the actuator fails', () => {
    const { report, verifier } = setup()
    verifier.expect('{w1}', true)
    verifier.failed('{w1}', true)
    expect(report).toHaveBeenCalledExactlyOnceWith(false)
    vi.advanceTimersByTime(2000)
    expect(report).toHaveBeenCalledOnce()
  })

  it('judges only the latest request when keep-above toggles rapidly', () => {
    const { report, verifier } = setup()
    verifier.expect('{w1}', true)
    verifier.applied('{w1}', true, [{ id: '{w1}', keepAbove: false }])
    verifier.expect('{w1}', false)
    // The push from the superseded request must not verify the new one.
    verifier.observe([{ id: '{w1}', keepAbove: true }])
    expect(report).not.toHaveBeenCalled()
    // A late completion of the superseded request starts no deadline.
    verifier.applied('{w1}', true, [{ id: '{w1}', keepAbove: true }])
    verifier.applied('{w1}', false, [{ id: '{w1}', keepAbove: true }])
    verifier.observe([{ id: '{w1}', keepAbove: false }])
    expect(report).toHaveBeenCalledExactlyOnceWith(true)
    vi.advanceTimersByTime(2000)
    expect(report).toHaveBeenCalledOnce()
  })

  it('gives no verdict for a window that closed before the push', () => {
    const { report, verifier } = setup()
    verifier.expect('{w1}', true)
    verifier.applied('{w1}', true, [{ id: '{w1}', keepAbove: false }])
    verifier.observe([])
    vi.advanceTimersByTime(2000)
    expect(report).not.toHaveBeenCalled()
  })

  it('forgets pending requests on reset', () => {
    const { report, verifier } = setup()
    verifier.expect('{w1}', true)
    verifier.applied('{w1}', true, null)
    verifier.reset()
    vi.advanceTimersByTime(2000)
    verifier.observe([{ id: '{w1}', keepAbove: true }])
    expect(report).not.toHaveBeenCalled()
  })
})

/** Fails with a clear message instead of hanging when the awaited boundary call never happens. */
function within<T>(promise: Promise<T>, what: string, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${what}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

describe('latestValueActuator', () => {
  it('applies the first value and then only the latest value submitted while it ran', async () => {
    const gates: Array<ReturnType<typeof Promise.withResolvers<void>>> = []
    const thirdApply = Promise.withResolvers<void>()
    const apply = vi.fn((_key: string, _value: number) => {
      const gate = Promise.withResolvers<void>()
      gates.push(gate)
      if (gates.length === 3)
        thirdApply.resolve()
      return gate.promise
    })
    const actuator = new LatestValueActuator({ apply, onError: vi.fn() })
    actuator.submit('a', 1)
    actuator.submit('a', 2)
    actuator.submit('a', 3)
    actuator.submit('b', 9)
    expect(apply.mock.calls).toEqual([['a', 1], ['b', 9]])
    gates[0]!.resolve()
    await within(thirdApply.promise, 'the third apply call')
    expect(apply).toHaveBeenCalledTimes(3)
    expect(apply.mock.calls[2]).toEqual(['a', 3])
    gates[2]!.resolve()
    gates[1]!.resolve()
    await Promise.resolve()
    expect(apply).toHaveBeenCalledTimes(3)
  })

  it('reports a failed application and keeps applying later values', async () => {
    const errored = Promise.withResolvers<void>()
    const secondApply = Promise.withResolvers<void>()
    const onError = vi.fn(() => errored.resolve())
    const apply = vi.fn(async (_key: string, value: number) => {
      if (value === 2)
        secondApply.resolve()
      if (value === 1)
        throw new Error('refused')
    })
    const actuator = new LatestValueActuator({ apply, onError })
    actuator.submit('a', 1)
    actuator.submit('a', 2)
    await within(Promise.all([errored.promise, secondApply.promise]), 'the failure report and the second apply call')
    expect(apply).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('drops a pending value that is cancelled before it runs', async () => {
    const gate = Promise.withResolvers<void>()
    const apply = vi.fn((_key: string, _value: number) => gate.promise)
    const actuator = new LatestValueActuator({ apply, onError: vi.fn() })
    actuator.submit('a', 1)
    actuator.submit('a', 2)
    actuator.cancel('a')
    gate.resolve()
    await new Promise(resolve => setImmediate(resolve))
    expect(apply).toHaveBeenCalledOnce()
  })
})
