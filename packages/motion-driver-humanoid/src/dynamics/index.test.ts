import { describe, expect, it } from 'vitest'

import { advanceSecondOrder, createInertializer, createLagChain, minJerk, secondOrderCoefficients, softLimit } from './index'

describe('exact second-order response', () => {
  it.each([
    { f: 0.7, zeta: 0.5, r: -0.4 },
    { f: 2, zeta: 1, r: 0 },
    { f: 1.2, zeta: 0.7, r: 1 },
    { f: 3, zeta: 0.8, r: 2 },
  ])('has the analytic steady ramp lag for $f Hz, damping $zeta and response $r', (params) => {
    const dt = 1 / 120
    const coefficients = secondOrderCoefficients(params, dt)
    const state = { y: 0, v: 0, x: 0 }
    for (let i = 1; i <= 2400; i++)
      advanceSecondOrder(state, i * dt, coefficients)
    const lag = params.zeta * (1 - params.r / 2) / (Math.PI * params.f)
    expect(20 - state.y).toBeCloseTo(lag, 9)
    expect(state.v).toBeCloseTo(1, 9)
  })

  it.each([0.3, 0.7, 0.999999999, 1])('composes two half ticks on a linear target at damping %s', (zeta) => {
    const params = { f: 2, zeta, r: -0.4 }
    const whole = { y: -0.4, v: 0.7, x: 0.2 }
    const halves = { ...whole }
    advanceSecondOrder(whole, 0.4, secondOrderCoefficients(params, 0.1))
    const halfTick = secondOrderCoefficients(params, 0.05)
    advanceSecondOrder(halves, 0.3, halfTick)
    advanceSecondOrder(halves, 0.4, halfTick)
    expect(Math.abs(whole.y - halves.y)).toBeLessThan(1e-9)
    expect(Math.abs(whole.v - halves.v)).toBeLessThan(1e-9)
  })

  it.each([0.3, 1])('stays bounded on ten-second ticks at damping %s', (zeta) => {
    const coefficients = secondOrderCoefficients({ f: 4, zeta, r: 0 }, 10)
    const state = { y: 0, v: 0, x: 0 }
    for (let i = 0; i < 20; i++) {
      advanceSecondOrder(state, i % 2 ? -1 : 1, coefficients)
      expect(Math.abs(state.y)).toBeLessThan(2)
      expect(Math.abs(state.v)).toBeLessThan(1)
    }
  })

  it('moves against a target step when response is negative', () => {
    const state = { y: 0, v: 0, x: 0 }
    advanceSecondOrder(state, 0.1, secondOrderCoefficients({ f: 1, zeta: 0.7, r: -0.5 }, 1 / 120))
    expect(state.y).toBeLessThan(0)
    expect(state.v).toBeLessThan(0)
  })

  it.each([{ zeta: 0.5, overshoots: true }, { zeta: 1, overshoots: false }])('overshoot is $overshoots at damping $zeta', ({ zeta, overshoots }) => {
    const state = { y: 0, v: 0, x: 0 }
    const coefficients = secondOrderCoefficients({ f: 1, zeta, r: 0 }, 1 / 120)
    let peak = 0
    for (let i = 0; i < 1200; i++) {
      advanceSecondOrder(state, 0.1, coefficients)
      peak = Math.max(peak, state.y)
    }
    expect(peak > 0.1 + 1e-12).toBe(overshoots)
    expect(state.y).toBeCloseTo(0.1, 9)
  })

  it('limits the target slope before applying response', () => {
    const coefficients = secondOrderCoefficients({ f: 1, zeta: 0.7, r: -0.5 }, 0.01)
    const cut = { y: 0, v: 0, x: 0 }
    const largerCut = { ...cut }
    advanceSecondOrder(cut, 100, coefficients)
    advanceSecondOrder(largerCut, 200, coefficients)
    expect(cut.y).toBe(largerCut.y)
    expect(cut.v).toBe(largerCut.v)
    expect(cut.x).toBe(100)
  })

  it('leaves the state untouched on a zero-duration tick', () => {
    const state = { y: 0.2, v: 0.4, x: 0.1 }
    advanceSecondOrder(state, 1, secondOrderCoefficients({ f: 1, zeta: 1, r: 0 }, 0))
    expect(state).toEqual({ y: 0.2, v: 0.4, x: 0.1 })
  })
})

describe('lag chain and shaping', () => {
  it('arrives in cascade order with additive steady ramp delays', () => {
    const delays = [0.05, 0.1, 0.08]
    const chain = createLagChain(delays, 1 / 120)
    let values: readonly number[] = []
    for (let i = 1; i <= 2400; i++)
      values = chain.step(i / 120)
    let lag = 0
    for (const [i, delay] of delays.entries()) {
      lag += delay
      expect(20 - values[i]).toBeCloseTo(lag, 8)
    }
  })

  it('preserves the middle range and smoothly approaches asymmetric limits', () => {
    expect(softLimit(0, -2, 4)).toBe(0)
    expect(softLimit(2, -2, 4)).toBe(2)
    let previous = -2
    for (let value = -20; value <= 20; value += 0.01) {
      const limited = softLimit(value, -2, 4)
      expect(limited).toBeGreaterThanOrEqual(-2)
      expect(limited).toBeLessThanOrEqual(4)
      expect(limited).toBeGreaterThanOrEqual(previous)
      previous = limited
    }
    const h = 1e-5
    // The upper knee is at centre + 80% of the half range.
    expect((softLimit(3.4 + h, -2, 4) - softLimit(3.4 - h, -2, 4)) / (2 * h)).toBeCloseTo(1, 6)
  })

  it('clamps minimum-jerk progress with stationary endpoints and symmetric travel', () => {
    expect(minJerk(-1)).toBe(0)
    expect(minJerk(2)).toBe(1)
    expect(minJerk(0.25) + minJerk(0.75)).toBeCloseTo(1, 12)
    expect(minJerk(0.001) / 0.001).toBeLessThan(0.0001)
    expect((1 - minJerk(0.999)) / 0.001).toBeLessThan(0.0001)
    let previous = 0
    for (let i = 0; i <= 100; i++) {
      const value = minJerk(i / 100)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe('inertialisation', () => {
  it('preserves output position and velocity across a cut', () => {
    const inertializer = createInertializer(2, 1 / 120)
    const previous = { y: 0.6, v: -0.2 }
    const next = { y: -0.4, v: 0.7 }
    inertializer.cut(0, previous.y - next.y, previous.v - next.v)
    expect(next.y + inertializer.positions[0]).toBeCloseTo(previous.y, 12)
    expect(next.v + inertializer.velocities[0]).toBeCloseTo(previous.v, 12)
    expect(inertializer.positions[1]).toBe(0)
  })

  it('decays position and velocity to rest', () => {
    const inertializer = createInertializer(1, 1 / 120)
    inertializer.cut(0, 1, -2)
    for (let i = 0; i < 1200; i++)
      inertializer.step(9)
    expect(Math.abs(inertializer.positions[0])).toBeLessThan(1e-12)
    expect(Math.abs(inertializer.velocities[0])).toBeLessThan(1e-12)
  })

  it('adds repeated cuts to the existing moving offset', () => {
    const one = createInertializer(1, 1 / 120)
    const two = createInertializer(1, 1 / 120)
    const combined = createInertializer(1, 1 / 120)
    one.cut(0, 1, 0.3)
    combined.cut(0, 1, 0.3)
    one.step(9)
    combined.step(9)
    two.cut(0, -0.2, 0.5)
    combined.cut(0, -0.2, 0.5)
    for (let i = 0; i < 60; i++) {
      one.step(9)
      two.step(9)
      combined.step(9)
    }
    expect(combined.positions[0]).toBeCloseTo(one.positions[0] + two.positions[0], 12)
    expect(combined.velocities[0]).toBeCloseTo(one.velocities[0] + two.velocities[0], 12)
    combined.reset()
    expect([...combined.positions, ...combined.velocities]).toEqual([0, 0])
  })
})
