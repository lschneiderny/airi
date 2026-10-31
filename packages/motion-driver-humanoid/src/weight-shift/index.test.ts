import { describe, expect, it } from 'vitest'

import { composeWeightShift, createWeightShift } from './index'

function collect(seed: number) {
  const shift = createWeightShift({ seed })
  return Array.from({ length: 1201 }, (_, index) => shift.step({ now: index / 10, hipY: 11.5, duck: 1 }))
}

function saturatedShift(seed: number, hipY: number, duck = 1) {
  const shift = createWeightShift({ seed })
  const initial = shift.step({ now: 0, hipY, duck })
  const now = initial.dwellSeconds + initial.transitionSeconds + 0.001
  return { now, output: shift.step({ now, hipY, duck }) }
}

describe('seeded weight shift', () => {
  it('replays equal seeds and diverges for different seeds', () => {
    const first = collect(17)
    const replay = collect(17)
    const different = collect(18)

    expect(first).toEqual(replay)
    expect(first).not.toEqual(different)
  })

  it('keeps every dwell and transition within its specified range over an hour', () => {
    const shift = createWeightShift({ seed: 2026 })

    for (let frame = 0; frame <= 3600 * 2; frame++) {
      const output = shift.step({ now: frame / 2, hipY: 11.5, duck: 1 })

      expect(output.dwellSeconds).toBeGreaterThanOrEqual(6)
      expect(output.dwellSeconds).toBeLessThanOrEqual(18)
      expect(output.transitionSeconds).toBeGreaterThanOrEqual(1.2)
      expect(output.transitionSeconds).toBeLessThanOrEqual(2)
    }
  })

  it('bounds the support value and derived offsets', () => {
    const shift = createWeightShift({ seed: 93 })
    const states = new Set<string>()

    for (let frame = 0; frame <= 3600; frame++) {
      const output = shift.step({ now: frame, hipY: 11.5, duck: 1 })
      states.add(output.state)

      expect(output.s).toBeGreaterThanOrEqual(-1)
      expect(output.s).toBeLessThanOrEqual(1)
      expect(output.offsets.pelvisLateral).toBeGreaterThanOrEqual(-0.515)
      expect(output.offsets.pelvisLateral).toBeLessThanOrEqual(0.515)
      expect(output.offsets.pelvisDrop).toBeGreaterThanOrEqual(0)
      expect(output.offsets.pelvisDrop).toBeLessThanOrEqual(0.06)
      expect(output.offsets.pelvisForeAft).toBeGreaterThanOrEqual(-0.03)
      expect(output.offsets.pelvisForeAft).toBeLessThanOrEqual(0.03)
      expect(Math.abs(output.offsets.lowerBodyRoll)).toBeLessThanOrEqual(4 * Math.PI / 180 + 1e-12)
      expect(Math.abs(output.offsets.lowerBodyYaw)).toBeLessThanOrEqual(3 * Math.PI / 180 + 1e-12)
      expect(Math.abs(output.offsets.upperBodyCounterRoll)).toBeLessThanOrEqual(2.5 * Math.PI / 180 + 1e-12)
      expect(Number.isFinite(output.offsets.lowerBodyRoll)).toBe(true)
      expect(Number.isFinite(output.offsets.lowerBodyYaw)).toBe(true)
      expect(Number.isFinite(output.offsets.upperBodyCounterRoll)).toBe(true)
    }

    expect([...states]).toEqual(expect.arrayContaining(['left', 'both', 'right']))
  })

  it('produces each planned physical offset at full left and right support', () => {
    const radiansPerDegree = Math.PI / 180

    for (const [seed, expectedS] of [[4, 1], [2026, -1]] as const) {
      for (const hipY of [5.75, 11.5, 23]) {
        const { now, output } = saturatedShift(seed, hipY)

        expect(output.s).toBe(expectedS)
        expect(output.offsets.pelvisLateral).toBeCloseTo(
          0.45 * expectedS * (hipY / 11.5)
          + 0.04 * Math.sin(2 * Math.PI * 0.23 * now)
          + 0.025 * Math.sin(2 * Math.PI * 0.37 * now),
          12,
        )
        expect(output.offsets.pelvisDrop).toBeCloseTo(0.06 * Math.abs(expectedS), 12)
        expect(output.offsets.pelvisForeAft).toBeCloseTo(0.03 * Math.sin(2 * Math.PI * 0.19 * now), 12)
        expect(output.offsets.lowerBodyRoll).toBeCloseTo(-4 * radiansPerDegree * expectedS, 12)
        expect(output.offsets.lowerBodyYaw).toBeCloseTo(3 * radiansPerDegree * expectedS, 12)
        expect(output.offsets.upperBodyCounterRoll).toBeCloseTo(2.5 * radiansPerDegree * expectedS, 12)
        expect(output.offsets.chestCounterRoll).toBeCloseTo(radiansPerDegree * expectedS, 12)
      }
    }
  })

  it('returns zero offsets when ducked completely', () => {
    const shift = createWeightShift({ seed: 4 })

    for (const now of [0, 0.5, 8, 12, 60, 120]) {
      expect(shift.step({ now, hipY: 11.5, duck: 0 }).offsets).toEqual({
        pelvisLateral: 0,
        pelvisDrop: 0,
        pelvisForeAft: 0,
        lowerBodyRoll: 0,
        lowerBodyYaw: 0,
        upperBodyCounterRoll: 0,
        chestCounterRoll: 0,
      })
    }
  })

  it('scales every physical offset by a fractional duck multiplier', () => {
    const full = saturatedShift(4, 11.5).output.offsets
    const half = saturatedShift(4, 11.5, 0.5).output.offsets
    const offsetNames = [
      'pelvisLateral',
      'pelvisDrop',
      'pelvisForeAft',
      'lowerBodyRoll',
      'lowerBodyYaw',
      'upperBodyCounterRoll',
      'chestCounterRoll',
    ] as const

    for (const name of offsetNames)
      expect(half[name]).toBeCloseTo(full[name] * 0.5, 12)
  })

  it('uses smootherstep rather than linear interpolation during a transition', () => {
    const shift = createWeightShift({ seed: 4 })
    const initial = shift.step({ now: 0, hipY: 11.5, duck: 1 })
    const transitionStart = shift.step({ now: initial.dwellSeconds, hipY: 11.5, duck: 1 })
    const quarter = shift.step({
      now: initial.dwellSeconds + initial.transitionSeconds * 0.25,
      hipY: 11.5,
      duck: 1,
    })
    const direction = transitionStart.state === 'left' ? -1 : 1

    expect(quarter.phase).toBe('transition')
    expect(quarter.s).toBeCloseTo(direction * 0.103515625, 12)
    expect(quarter.s).not.toBeCloseTo(direction * 0.25, 4)
  })

  it('samples dwell durations with a log-uniform distribution', () => {
    const dwellDurations = Array.from({ length: 2048 }, (_, seed) =>
      createWeightShift({ seed }).step({ now: 0, hipY: 11.5, duck: 1 }).dwellSeconds).sort((left, right) => left - right)
    const median = (dwellDurations[1023] + dwellDurations[1024]) / 2

    expect(median).toBeGreaterThan(10.1)
    expect(median).toBeLessThan(10.7)
  })

  it('composes distinct Natural inputs with nonzero incoming weight-shift offsets', () => {
    const weightShift = saturatedShift(4, 11.5).output
    const composed = composeWeightShift({
      weightShift,
      naturalBodyX: 0.5,
      naturalBodyRoll: -0.25,
      breath: 0.75,
    })

    expect(weightShift.offsets.pelvisLateral).not.toBe(0)
    expect(composed.pelvisLateral).toBeCloseTo(weightShift.offsets.pelvisLateral + 0.15 * -0.25, 12)
    expect(composed.pelvisDrop).toBe(weightShift.offsets.pelvisDrop)
    expect(composed.pelvisForeAft).toBe(weightShift.offsets.pelvisForeAft)
    expect(composed.lowerBodyRoll).toBe(weightShift.offsets.lowerBodyRoll)
    expect(composed.lowerBodyYaw).toBe(weightShift.offsets.lowerBodyYaw)
    expect(composed.upperBodyRoll).toBe(weightShift.offsets.upperBodyCounterRoll)
    expect(composed.chestCounterRoll).toBe(weightShift.offsets.chestCounterRoll)
    expect(composed.spinePitch).toBeCloseTo(0.5 * 10 * Math.PI / 180 * 0.6, 12)
    expect(composed.chestPitch).toBeCloseTo(
      0.5 * 10 * Math.PI / 180 * 0.4 + 0.75 * 0.6 * Math.PI / 180,
      12,
    )

    const negative = composeWeightShift({
      weightShift,
      naturalBodyX: -1,
      naturalBodyRoll: 0.5,
      breath: -1,
    })

    expect(negative.pelvisLateral).toBeCloseTo(weightShift.offsets.pelvisLateral + 0.15 * 0.5, 12)
    expect(negative.spinePitch).toBeCloseTo(-10 * Math.PI / 180 * 0.6, 12)
    expect(negative.chestPitch).toBeCloseTo(-10 * Math.PI / 180 * 0.4 - 0.6 * Math.PI / 180, 12)
  })
})
