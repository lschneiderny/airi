import type { CpuBaselineMemory, FrameStallInput, FrameStallMemory, IncidentConditions, IncidentDecision, MemoryGrowthMemory, PeggedMemory } from './incidents'

import { describe, expect, it } from 'vitest'

import {
  decideFrameStall,
  decideMemoryGrowth,
  decidePegged,
  INCIDENT_CALM,
  IncidentBudget,
  INITIAL_FRAME_STALL_MEMORY,
  INITIAL_MEMORY_GROWTH_MEMORY,
  INITIAL_PEGGED_MEMORY,
  trackCpuBaseline,
} from './incidents'

const MINUTE = 60_000
const MIB = 1024

/** A frame histogram over `FRAME_BINS_V1` with `slow` frames in the [100, 150) ms bin and the rest at 16 ms. */
function rollup(options: { slow?: number, frameMaxMs?: number, longTaskMaxMs?: number } = {}): FrameStallInput['rollup'] {
  const frameHist = Array.from<number>({ length: 22 }).fill(0)
  frameHist[7] = 290
  frameHist[16] = options.slow ?? 0
  return { frameHist, frameMaxMs: options.frameMaxMs ?? 16.9, longTasks: { count: 0, maxMs: options.longTaskMaxMs ?? 0, sumMs: 0 } }
}

function stallInput(value: FrameStallInput['rollup'], conditions: IncidentConditions = INCIDENT_CALM): FrameStallInput {
  return { rollup: value, conditions }
}

/** Feeds rollups 5 s apart from `startMs` and returns every decision. */
function feedStall(memory: FrameStallMemory, inputs: FrameStallInput[], startMs: number): IncidentDecision<FrameStallMemory>[] {
  const decisions: IncidentDecision<FrameStallMemory>[] = []
  let current = memory
  inputs.forEach((input, index) => {
    const decision = decideFrameStall(current, input, startMs + index * 5000)
    decisions.push(decision)
    current = decision.memory
  })
  return decisions
}

const clean = (count: number) => Array.from({ length: count }, () => stallInput(rollup()))

describe('decideFrameStall', () => {
  it.each([
    ['3 frames >= 100 ms', true, rollup({ slow: 3 })],
    ['2 frames >= 100 ms', false, rollup({ slow: 2 })],
    ['one 500 ms frame', true, rollup({ frameMaxMs: 500 })],
    ['one 499.9 ms frame', false, rollup({ slow: 1, frameMaxMs: 499.9 })],
    ['a 500 ms long task', true, rollup({ longTaskMaxMs: 500 })],
    ['a 499 ms long task', false, rollup({ longTaskMaxMs: 499 })],
    ['a rollup-missing pull', true, null],
  ])('decides %s -> fire %s', (_name, fire, value) => {
    const decision = decideFrameStall(INITIAL_FRAME_STALL_MEMORY, stallInput(value), 0)

    expect(decision.fire).toBe(fire)
    expect(decision.suppressedReason).toBeUndefined()
  })

  it('fires once per episode and clears after 6 consecutive clean rollups', () => {
    const fired = decideFrameStall(INITIAL_FRAME_STALL_MEMORY, stallInput(rollup({ slow: 3 })), 0)
    const afterFive = feedStall(fired.memory, [...clean(5), stallInput(rollup({ slow: 5 }))], 20 * MINUTE)
    const afterSix = feedStall(fired.memory, [...clean(6), stallInput(rollup({ slow: 5 }))], 20 * MINUTE)

    expect(afterFive.at(-1)).toMatchObject({ fire: false, memory: { active: true } })
    expect(afterFive.at(-1)?.suppressedReason).toBeUndefined()
    expect(afterSix.at(-1)?.fire).toBe(true)
  })

  it('restarts the clean count when a stall interrupts it', () => {
    const fired = decideFrameStall(INITIAL_FRAME_STALL_MEMORY, stallInput(null), 0)
    const decisions = feedStall(fired.memory, [...clean(3), stallInput(null), ...clean(5), stallInput(null)], 20 * MINUTE)

    expect(decisions.some(decision => decision.fire)).toBe(false)
  })

  it('suppresses a new episode inside the 10 min cooldown and fires at its end', () => {
    const fired = decideFrameStall(INITIAL_FRAME_STALL_MEMORY, stallInput(null), 0)
    const cleared = feedStall(fired.memory, clean(6), MINUTE).at(-1)?.memory ?? fired.memory

    const early = decideFrameStall(cleared, stallInput(null), 10 * MINUTE - 1)
    const onTime = decideFrameStall(cleared, stallInput(null), 10 * MINUTE)

    expect(early).toMatchObject({ fire: false, suppressedReason: 'cooldown' })
    expect(decideFrameStall(early.memory, stallInput(null), 10 * MINUTE).fire).toBe(false)
    expect(onTime.fire).toBe(true)
  })

  it.each([
    ['suspended', { suspended: true, hidden: true, settling: true, chromiumTrace: true, hostContended: true }],
    ['hidden', { hidden: true, settling: true, chromiumTrace: true, hostContended: true }],
    ['settling', { settling: true, chromiumTrace: true, hostContended: true }],
    ['chromium-trace', { chromiumTrace: true, hostContended: true }],
    ['host-contended', { hostContended: true }],
  ])('suppresses with %s, the first condition that holds', (reason, conditions) => {
    const decision = decideFrameStall(INITIAL_FRAME_STALL_MEMORY, stallInput(null, { ...INCIDENT_CALM, ...conditions }), 0)

    expect(decision).toMatchObject({ fire: false, suppressedReason: reason, memory: { active: false, lastFireMs: null } })
  })

  it('reports a condition once per stretch and again after a calm rollup', () => {
    const contended = { ...INCIDENT_CALM, hostContended: true }
    const decisions = feedStall(INITIAL_FRAME_STALL_MEMORY, [stallInput(null, contended), stallInput(null, contended), stallInput(rollup()), stallInput(null, contended)], 0)

    expect(decisions.map(decision => decision.suppressedReason ?? null)).toEqual(['host-contended', null, null, 'host-contended'])
    expect(decisions.some(decision => decision.fire)).toBe(false)
  })

  it('fires a stall that outlasts the condition that suppressed it', () => {
    const settling = { ...INCIDENT_CALM, settling: true }
    const janky = (conditions: IncidentConditions) => stallInput(rollup({ slow: 5 }), conditions)
    const decisions = feedStall(INITIAL_FRAME_STALL_MEMORY, [janky(settling), janky(settling), janky(settling), janky(settling), janky(INCIDENT_CALM), janky(INCIDENT_CALM), janky(INCIDENT_CALM)], 0)

    expect(decisions.map(decision => decision.suppressedReason ?? null)).toEqual(['settling', null, null, null, null, null, null])
    expect(decisions.map(decision => decision.fire)).toEqual([false, false, false, false, true, false, false])
  })

  it('never mutates the memory it receives', () => {
    const memory = Object.freeze({ ...INITIAL_FRAME_STALL_MEMORY })

    expect(() => feedStall(memory, [stallInput(null), ...clean(6)], 0)).not.toThrow()
    expect(memory).toEqual(INITIAL_FRAME_STALL_MEMORY)
  })
})

describe('decidePegged', () => {
  function feed(memory: PeggedMemory, values: (number | null)[], startMs = 0, baselinePct: number | null = 0): IncidentDecision<PeggedMemory>[] {
    const decisions: IncidentDecision<PeggedMemory>[] = []
    let current = memory
    values.forEach((cpuPctOfCore, index) => {
      const decision = decidePegged(current, { cpuPctOfCore, baselinePct, nowMs: startMs + index * 5000, conditions: INCIDENT_CALM })
      decisions.push(decision)
      current = decision.memory
    })
    return decisions
  }
  const hot = (count: number) => Array.from<number>({ length: count }).fill(95)

  it('fires on the 6th consecutive sample at or above 90 % and not before', () => {
    const decisions = feed(INITIAL_PEGGED_MEMORY, [90, 90, 90, 90, 90, 90])

    expect(decisions.map(decision => decision.fire)).toEqual([false, false, false, false, false, true])
  })

  it.each([
    ['a steady 101 % over a 100 % baseline', false, 100, 101],
    ['a jump to 95 % over a 40 % baseline', true, 40, 95],
    ['90 %, exactly 25 points over a 65 % baseline', true, 65, 90],
    ['90 %, 24.9 points over a 65.1 % baseline', false, 65.1, 90],
    ['95 % before the process has a baseline', false, null, 95],
  ])('decides %s for 6 samples -> fire %s', (_name, fire, baselinePct, value) => {
    expect(feed(INITIAL_PEGGED_MEMORY, Array.from<number>({ length: 6 }).fill(value), 0, baselinePct).at(-1)?.fire).toBe(fire)
  })

  it.each([
    ['89.99 %', 89.99],
    ['an unknown CPU reading', null],
  ])('restarts the streak on %s', (_name, value) => {
    const decisions = feed(INITIAL_PEGGED_MEMORY, [...hot(5), value, ...hot(5)])

    expect(decisions.some(decision => decision.fire)).toBe(false)
  })

  it('clears after 3 consecutive samples below 60 % and only then fires again', () => {
    const fired = feed(INITIAL_PEGGED_MEMORY, hot(6)).at(-1)?.memory ?? INITIAL_PEGGED_MEMORY
    const twoCool = feed(fired, [59, 59, 60, ...hot(6)], 20 * MINUTE)
    const threeCool = feed(fired, [59, 59, 59.99, ...hot(6)], 20 * MINUTE)

    expect(twoCool.some(decision => decision.fire)).toBe(false)
    expect(threeCool.at(-1)?.fire).toBe(true)
  })

  it('suppresses a new episode inside the 10 min cooldown and fires at its end', () => {
    const fired = feed(INITIAL_PEGGED_MEMORY, hot(6)).at(-1)?.memory ?? INITIAL_PEGGED_MEMORY
    const cleared = feed(fired, [10, 10, 10], MINUTE).at(-1)?.memory ?? fired
    const sixthHotAt = (endMs: number) => feed(cleared, hot(6), endMs - 5 * 5000).at(-1)

    expect(fired.lastFireMs).toBe(25_000)
    expect(sixthHotAt(25_000 + 10 * MINUTE - 1)).toMatchObject({ fire: false, suppressedReason: 'cooldown' })
    expect(sixthHotAt(25_000 + 10 * MINUTE)?.fire).toBe(true)
  })

  it('fires a pegged process that outlasts the condition that suppressed it', () => {
    const decisions: IncidentDecision<PeggedMemory>[] = []
    let memory = INITIAL_PEGGED_MEMORY
    for (let nowMs = 5000; nowMs <= 2 * MINUTE; nowMs += 5000) {
      const decision = decidePegged(memory, { cpuPctOfCore: 100, baselinePct: 0, nowMs, conditions: { ...INCIDENT_CALM, settling: nowMs < 50_000 } })
      decisions.push(decision)
      memory = decision.memory
    }
    const at = (nowMs: number) => decisions[nowMs / 5000 - 1]

    expect(decisions.filter(decision => decision.suppressedReason !== undefined)).toEqual([at(30_000)])
    expect(at(30_000).suppressedReason).toBe('settling')
    expect(decisions.filter(decision => decision.fire)).toEqual([at(50_000)])
  })

  it('reports a condition again after a calm sample that broke the streak', () => {
    const settling = { ...INCIDENT_CALM, settling: true }
    const steps: [number, IncidentConditions][] = [
      ...Array.from({ length: 6 }, (): [number, IncidentConditions] => [100, settling]),
      [50, INCIDENT_CALM],
      ...Array.from({ length: 6 }, (): [number, IncidentConditions] => [100, settling]),
      [100, INCIDENT_CALM],
    ]
    let memory = INITIAL_PEGGED_MEMORY
    const decisions = steps.map(([cpuPctOfCore, conditions], index) => {
      const decision = decidePegged(memory, { cpuPctOfCore, baselinePct: 0, nowMs: index * 5000, conditions })
      memory = decision.memory
      return decision
    })

    expect(decisions.flatMap((decision, index) => (decision.suppressedReason === undefined ? [] : [index]))).toEqual([5, 12])
    expect(decisions.flatMap((decision, index) => (decision.fire ? [index] : []))).toEqual([13])
  })

  it('suppresses while a condition holds', () => {
    let memory = INITIAL_PEGGED_MEMORY
    let decision: IncidentDecision<PeggedMemory> | undefined
    for (let index = 0; index < 6; index++) {
      decision = decidePegged(memory, { cpuPctOfCore: 99, baselinePct: 0, nowMs: index * 5000, conditions: { ...INCIDENT_CALM, chromiumTrace: true } })
      memory = decision.memory
    }

    expect(decision).toMatchObject({ fire: false, suppressedReason: 'chromium-trace' })
  })
})

describe('trackCpuBaseline', () => {
  /** Feeds one sample every 5 s from `fromMs` to `toMs` and returns the last baseline and memory. */
  function feed(memory: CpuBaselineMemory | null, fromMs: number, toMs: number, cpuAt: (atMs: number) => number | null, modelLoadMs: number | null = null) {
    let current = memory
    let baselinePct: number | null = null
    for (let nowMs = fromMs; nowMs <= toMs; nowMs += 5000) {
      const tracked = trackCpuBaseline(current, { cpuPctOfCore: cpuAt(nowMs), nowMs, modelLoadMs })
      current = tracked.memory
      baselinePct = tracked.baselinePct
    }
    return { baselinePct, memory: current }
  }

  it('settles on the median of minutes 2-5 after the first sample and has none until then', () => {
    // A load spike in the first 2 min and an unknown reading must not count.
    const cpuAt = (atMs: number) => atMs < 2 * MINUTE ? 180 : atMs === 3 * MINUTE ? null : (atMs / 5000) % 2 === 0 ? 40 : 50

    expect(feed(null, 0, 5 * MINUTE, cpuAt).baselinePct).toBeNull()
    expect(feed(null, 0, 5 * MINUTE + 5000, cpuAt).baselinePct).toBe(45)
  })

  it('restarts at the window\'s model load', () => {
    const settled = feed(null, 0, 6 * MINUTE, () => 30).memory
    const reload = 10 * MINUTE

    expect(feed(settled, reload, reload + 5 * MINUTE, atMs => atMs < reload + 2 * MINUTE ? 30 : 100, reload).baselinePct).toBeNull()
    expect(feed(settled, reload, reload + 5 * MINUTE + 5000, atMs => atMs < reload + 2 * MINUTE ? 30 : 100, reload).baselinePct).toBe(100)
  })
})

describe('decideMemoryGrowth', () => {
  const BASELINE_KB = 500_000

  /** Working set every 5 s from 5 s after a model load at 0: flat until 5 min, then growing at `mibPerMin`. */
  function series(mibPerMin: number, growthSamples: number): [number, number][] {
    const points: [number, number][] = []
    for (let atMs = 5000; atMs <= 5 * MINUTE; atMs += 5000)
      points.push([atMs, BASELINE_KB])
    for (let index = 1; index <= growthSamples; index++)
      points.push([5 * MINUTE + index * 5000, BASELINE_KB + mibPerMin * MIB / 12 * index])
    return points
  }

  function feed(memory: MemoryGrowthMemory, points: [number, number][], conditions: IncidentConditions = INCIDENT_CALM): IncidentDecision<MemoryGrowthMemory>[] {
    const decisions: IncidentDecision<MemoryGrowthMemory>[] = []
    let current = memory
    for (const [nowMs, workingSetKb] of points) {
      const decision = decideMemoryGrowth(current, { workingSetKb, nowMs, modelLoadMs: 0, conditions })
      decisions.push(decision)
      current = decision.memory
    }
    return decisions
  }

  const fires = (decisions: IncidentDecision<MemoryGrowthMemory>[]) => decisions.filter(decision => decision.fire).length

  it('fires on 25 MiB/min growth that reaches +350 MiB and not on +250 MiB', () => {
    expect(fires(feed(INITIAL_MEMORY_GROWTH_MEMORY, series(25, 14 * 12)))).toBe(1)
    expect(fires(feed(INITIAL_MEMORY_GROWTH_MEMORY, series(25, 10 * 12)))).toBe(0)
  })

  it('fires at exactly +300 MiB over the baseline and not 1 KiB below it', () => {
    // 30 MiB/min is 2560 KiB per 5 s sample, so sample 120 is exactly +300 MiB.
    const decisions = feed(INITIAL_MEMORY_GROWTH_MEMORY, series(30, 120))
    const below = feed(INITIAL_MEMORY_GROWTH_MEMORY, [...series(30, 119), [5 * MINUTE + 120 * 5000, BASELINE_KB + 300 * MIB - 1]])

    expect(decisions.findIndex(decision => decision.fire)).toBe(decisions.length - 1)
    expect(fires(below)).toBe(0)
  })

  it('needs a slope above 20 MiB/min', () => {
    // Float least squares cannot hit exactly 20, so the boundary is checked just on either side of it.
    expect(fires(feed(INITIAL_MEMORY_GROWTH_MEMORY, series(19.9, 30 * 12)))).toBe(0)
    expect(fires(feed(INITIAL_MEMORY_GROWTH_MEMORY, series(20.1, 30 * 12)))).toBe(1)
  })

  it('takes the baseline from minutes 2-5 after the model load, not from before', () => {
    // A 1 GiB load spike in the first 2 min must not raise the baseline.
    const spiky = series(30, 120).map(([atMs, kb]): [number, number] => [atMs, atMs < 2 * MINUTE ? kb + 1024 * MIB : kb])

    expect(feed(INITIAL_MEMORY_GROWTH_MEMORY, spiky).at(-1)?.fire).toBe(true)
  })

  it('restarts the baseline when the window loads a model again', () => {
    // A larger model settles 400 MiB higher, then grows 240 MiB: under +300 MiB of its own baseline, over the old one.
    const reload = 10 * MINUTE
    const before = series(0, 5 * 12)
    const after: [number, number][] = []
    for (let atMs = reload + 5000; atMs <= reload + 5 * MINUTE; atMs += 5000)
      after.push([atMs, BASELINE_KB + 400 * MIB])
    for (let index = 1; index <= 8 * 12; index++)
      after.push([reload + 5 * MINUTE + index * 5000, BASELINE_KB + 400 * MIB + 2560 * index])

    let memory = feed(INITIAL_MEMORY_GROWTH_MEMORY, before).at(-1)?.memory ?? INITIAL_MEMORY_GROWTH_MEMORY
    const decisions = after.map(([nowMs, workingSetKb]) => {
      const decision = decideMemoryGrowth(memory, { workingSetKb, nowMs, modelLoadMs: reload, conditions: INCIDENT_CALM })
      memory = decision.memory
      return decision
    })

    expect(fires(decisions)).toBe(0)
    expect(memory.anchorMs).toBe(reload)
  })

  it('clears after 5 min below 5 MiB/min and then needs a further +300 MiB over the last fire', () => {
    const toFire = series(30, 120)
    const fireKb = BASELINE_KB + 300 * MIB
    const fireAt = toFire.at(-1)?.[0] ?? 0
    const flat: [number, number][] = Array.from({ length: 40 * 12 }, (_, index) => [fireAt + (index + 1) * 5000, fireKb])
    const regrowFrom = fireAt + 40 * MINUTE
    const regrow = (samples: number): [number, number][] => Array.from({ length: samples }, (_, index) => [regrowFrom + (index + 1) * 5000, fireKb + 2560 * (index + 1)])

    const short = feed(INITIAL_MEMORY_GROWTH_MEMORY, [...toFire, ...flat, ...regrow(119)])
    const enough = feed(INITIAL_MEMORY_GROWTH_MEMORY, [...toFire, ...flat, ...regrow(120)])

    expect(short.findIndex(decision => decision.fire)).toBe(toFire.length - 1)
    expect(short.at(-1)?.memory.active).toBe(false)
    expect(fires(short)).toBe(1)
    expect(fires(enough)).toBe(2)
  })

  it('keeps an episode open while growth continues, without firing again', () => {
    const decisions = feed(INITIAL_MEMORY_GROWTH_MEMORY, series(30, 300))

    expect(fires(decisions)).toBe(1)
    expect(decisions.at(-1)?.memory.active).toBe(true)
  })

  it('suppresses a new episode inside the 30 min cooldown and fires at its end', () => {
    const ramp = (endMs: number, endKb: number): MemoryGrowthMemory['samples'] =>
      Array.from({ length: 119 }, (_, index) => ({ atMs: endMs - (119 - index) * 5000, kb: endKb - 2560 * (119 - index) }))
    const lastFireMs = 10 * MINUTE
    const memoryAt = (nowMs: number): MemoryGrowthMemory => ({
      ...INITIAL_MEMORY_GROWTH_MEMORY,
      anchorMs: 0,
      modelLoadMs: 0,
      baselineKb: [BASELINE_KB],
      samples: ramp(nowMs - 5000, BASELINE_KB + 700 * MIB - 2560),
      lastFireMs,
      lastFireKb: BASELINE_KB + 300 * MIB,
    })
    const at = (nowMs: number) => decideMemoryGrowth(memoryAt(nowMs), { workingSetKb: BASELINE_KB + 700 * MIB, nowMs, modelLoadMs: 0, conditions: INCIDENT_CALM })

    expect(at(lastFireMs + 30 * MINUTE - 1)).toMatchObject({ fire: false, suppressedReason: 'cooldown' })
    expect(at(lastFireMs + 30 * MINUTE).fire).toBe(true)
  })

  it('fires growth that outlasts the condition that suppressed it', () => {
    // The +300 MiB crossing at 15 min falls inside one minute of host contention.
    let memory = INITIAL_MEMORY_GROWTH_MEMORY
    const decisions = series(30, 200).map(([nowMs, workingSetKb]) => {
      const hostContended = nowMs >= 15 * MINUTE && nowMs < 16 * MINUTE
      const decision = decideMemoryGrowth(memory, { workingSetKb, nowMs, modelLoadMs: 0, conditions: { ...INCIDENT_CALM, hostContended } })
      memory = decision.memory
      return { nowMs, decision }
    })

    expect(decisions.filter(({ decision }) => decision.suppressedReason !== undefined).map(({ nowMs, decision }) => [nowMs, decision.suppressedReason])).toEqual([[15 * MINUTE, 'host-contended']])
    expect(decisions.filter(({ decision }) => decision.fire).map(({ nowMs }) => nowMs)).toEqual([16 * MINUTE])
  })

  it('reports a condition again after a calm sample below the threshold', () => {
    const dipAt = 15 * MINUTE + 5000
    let memory = INITIAL_MEMORY_GROWTH_MEMORY
    const decisions = series(30, 123).map(([nowMs, trendKb]) => {
      const workingSetKb = nowMs === dipAt ? BASELINE_KB + 300 * MIB - 1 : trendKb
      const hostContended = nowMs === 15 * MINUTE || nowMs === 15 * MINUTE + 10_000
      const decision = decideMemoryGrowth(memory, { workingSetKb, nowMs, modelLoadMs: 0, conditions: { ...INCIDENT_CALM, hostContended } })
      memory = decision.memory
      return { nowMs, decision }
    })

    expect(decisions.filter(({ decision }) => decision.suppressedReason !== undefined).map(({ nowMs }) => nowMs)).toEqual([15 * MINUTE, 15 * MINUTE + 10_000])
    expect(decisions.filter(({ decision }) => decision.fire).map(({ nowMs }) => nowMs)).toEqual([15 * MINUTE + 15_000])
  })

  it('suppresses while a condition holds', () => {
    const decisions = feed(INITIAL_MEMORY_GROWTH_MEMORY, series(30, 120), { ...INCIDENT_CALM, suspended: true })

    expect(decisions.at(-1)).toMatchObject({ fire: false, suppressedReason: 'suspended' })
  })

  it('never mutates the memory it receives and keeps at most 10 min of samples', () => {
    const memory = Object.freeze({ ...INITIAL_MEMORY_GROWTH_MEMORY })
    const decisions = feed(memory, series(1, 60 * 12))

    expect(memory).toEqual(INITIAL_MEMORY_GROWTH_MEMORY)
    expect(decisions.at(-1)?.memory.samples.length).toBe(120)
  })
})

describe('incidentBudget', () => {
  it('admits 6 incidents per rolling hour', () => {
    const budget = new IncidentBudget()
    const admitted = [0, 1, 2, 3, 4, 5].map(minute => budget.admit(minute * MINUTE).fire)

    expect(admitted).toEqual([true, true, true, true, true, true])
    expect(budget.admit(60 * MINUTE - 1)).toEqual({ fire: false, suppressedReason: 'budget' })
    expect(budget.admit(60 * MINUTE)).toEqual({ fire: true })
  })

  it('admits 20 incidents per rolling day', () => {
    const budget = new IncidentBudget()
    // 10 min apart stays within the hourly cap, so only the daily cap can refuse.
    for (let index = 0; index < 20; index++)
      expect(budget.admit(index * 10 * MINUTE).fire).toBe(true)

    expect(budget.admit(24 * 60 * MINUTE - 1)).toEqual({ fire: false, suppressedReason: 'budget' })
    expect(budget.admit(24 * 60 * MINUTE)).toEqual({ fire: true })
  })

  it('does not count refused incidents against the budget', () => {
    const budget = new IncidentBudget()
    for (let minute = 0; minute < 6; minute++)
      budget.admit(minute * MINUTE)
    for (let attempt = 0; attempt < 50; attempt++)
      budget.admit(30 * MINUTE)

    expect(budget.admit(60 * MINUTE).fire).toBe(true)
  })
})
