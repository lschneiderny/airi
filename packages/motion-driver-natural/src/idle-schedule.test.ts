import type { NaturalIdleDrive } from './idle-activities'
import type { IdleView } from './idle-schedule'

import { describe, expect, it } from 'vitest'

import { advanceIdleSchedule, applyIdleEdge, dormantIdleView, idleActivityRate, idleActivityWeights, initialIdleSchedule, nextIdleDeadline, sameIdleDrive } from './idle-schedule'
import { createRandomStream } from './random'

const dt = 1 / 120
const neutralDrive: NaturalIdleDrive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, rate: 1 }

describe('idle activity odds', () => {
  it('favours yawns, zoning out and nodding off when she is tired', () => {
    const rested = idleActivityWeights(neutralDrive, { watching: false, music: false })
    const tired = idleActivityWeights({ ...neutralDrive, sleepiness: 0.9 }, { watching: false, music: false })
    expect(rested['nod-off']).toBe(0)
    expect(tired['nod-off']).toBeGreaterThan(0)
    expect(tired.yawn).toBeGreaterThan(5 * rested.yawn)
    expect(tired['zone-out']).toBeGreaterThan(rested['zone-out'])
    expect(tired['look-around']).toBeLessThan(rested['look-around'])
  })

  it('watches the screen more while the user is active and checks in more after a long silence', () => {
    expect(idleActivityWeights(neutralDrive, { watching: true, music: false }).peer).toBeGreaterThan(3 * idleActivityWeights(neutralDrive, { watching: false, music: false }).peer)
    expect(idleActivityWeights({ ...neutralDrive, solitude: 1 }, { watching: false, music: false })['check-in'])
      .toBeGreaterThan(1.5 * idleActivityWeights(neutralDrive, { watching: false, music: false })['check-in'])
  })

  it('draws the whole-body kinds only for a host that performs a body', () => {
    const bodyKinds = ['sigh', 'shoulder-roll', 'arm-swing', 'shift-stance', 'clasp-hands'] as const
    const live2d = idleActivityWeights(neutralDrive, { watching: false, music: false })
    const mmd = idleActivityWeights({ ...neutralDrive, body: true }, { watching: false, music: false })
    const bright = idleActivityWeights({ ...neutralDrive, body: true, valence: 0.5 }, { watching: false, music: false })
    for (const kind of [...bodyKinds, 'hair-touch', 'heel-rock'] as const)
      expect([live2d[kind], idleActivityWeights({ ...neutralDrive, valence: 0.5 }, { watching: false, music: false })[kind]], kind).toEqual([0, 0])
    for (const kind of bodyKinds)
      expect(mmd[kind], kind).toBeGreaterThan(0)
    // Each takes its 4e act weight: the stance shift 1.2 (act 3), the clasp 0.7 (act 6), the hair tuck 0.5 (act 8), and
    // the heel raise 0 unless valence is above 0.3, then 0.8 (act 11).
    expect(mmd['shift-stance']).toBe(1.2)
    expect(mmd['clasp-hands']).toBe(0.7)
    expect([mmd['hair-touch'], bright['hair-touch']]).toEqual([0.5, 0.5])
    expect([mmd['heel-rock'], bright['heel-rock']]).toEqual([0, 0.8])
  })

  it('never draws a whole-body kind the host\'s body cannot perform, and leaves the others as they were', () => {
    const body = { ...neutralDrive, body: true }
    const all = idleActivityWeights(body, { watching: false, music: false })
    const limited = idleActivityWeights({ ...body, unreachable: ['clasp-hands', 'hair-touch'] }, { watching: false, music: false })
    expect(all['clasp-hands']).toBeGreaterThan(0)
    expect(all['hair-touch']).toBeGreaterThan(0)
    expect([limited['clasp-hands'], limited['hair-touch']]).toEqual([0, 0])
    expect({ ...limited, 'clasp-hands': all['clasp-hands'], 'hair-touch': all['hair-touch'] }).toEqual(all)
  })

  it('starts nothing that needs her arms or a standing posture while she is settled in', () => {
    const settled = { watching: false, music: false, settled: true }
    const weights = idleActivityWeights({ ...neutralDrive, body: true, sleepiness: 0.5 }, settled)
    for (const kind of ['stretch', 'peer', 'shoulder-roll', 'arm-swing'] as const)
      expect(weights[kind], kind).toBe(0)
    // Architecture 4f lets the sigh, the yawn and the foot re-plant play while she rests.
    expect(weights['shift-stance']).toBeGreaterThan(0)
    expect(weights.sigh).toBeGreaterThan(0)
    expect(weights.yawn).toBeGreaterThan(0)
  })

  it('weighs a kind she showed recently less on a body host, back to its full weight after 300 s', () => {
    const body = { ...neutralDrive, body: true }
    const fresh = idleActivityWeights(body, { watching: false, music: false })
    const recent = idleActivityWeights(body, { watching: false, music: false, since: { 'look-around': 60 } })
    expect(recent['look-around']).toBeCloseTo(fresh['look-around'] / 5)
    expect(recent['check-in']).toBe(fresh['check-in'])
    expect(idleActivityWeights(body, { watching: false, music: false, since: { 'look-around': 300 } })['look-around']).toBe(fresh['look-around'])
    // A head-only host draws as it did before.
    expect(idleActivityWeights(neutralDrive, { watching: false, music: false, since: { 'look-around': 60 } })).toEqual(idleActivityWeights(neutralDrive, { watching: false, music: false }))
  })

  it('sways only while music plays', () => {
    expect(idleActivityWeights(neutralDrive, { watching: false, music: false }).sway).toBe(0)
    expect(idleActivityWeights(neutralDrive, { watching: false, music: true }).sway).toBeGreaterThan(0)
  })

  it('paces activities by mood energy and the host rate, and treats bad numbers as neutral', () => {
    const base = idleActivityRate(neutralDrive, { watching: false })
    expect(idleActivityRate({ ...neutralDrive, energy: 1 }, { watching: false })).toBeGreaterThan(base)
    expect(idleActivityRate({ ...neutralDrive, energy: -1 }, { watching: false })).toBeLessThan(base)
    expect(idleActivityRate({ ...neutralDrive, rate: 0 }, { watching: false })).toBe(0)
    expect(idleActivityRate(neutralDrive, { watching: true })).toBeLessThan(base)
    expect(idleActivityRate({ ...neutralDrive, energy: Number.NaN }, { watching: false })).toBe(base)
  })
})

describe('idle schedule', () => {
  it('names the time of the first decision: the end of the rest, then the crossing of the hazard that a grid search finds', () => {
    const view: IdleView = { drive: neutralDrive, active: true, mode: 'idle', away: false, blocked: false, current: null, errand: null }
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = createRandomStream(seed)
      let state = applyIdleEdge(applyIdleEdge(initialIdleSchedule(), { kind: 'started', act: 'yawn' }, 0, random), { kind: 'ended', act: 'yawn', how: 'finished', sleptSeconds: null }, 0, random)
      // In the rest nothing is due but its end, where the hazard draws its threshold.
      expect(nextIdleDeadline(state, view, 0)).toBe(state.restUntil)
      let at = 0
      let deadline: number | null = null
      let decidedAt: number | null = null
      for (let step = 0; decidedAt === null && step < 3600 / dt; step++) {
        at = step * dt
        const result = advanceIdleSchedule(state, view, { music: false, settled: false }, at, dt, random)
        state = result.state
        if (result.decision !== null)
          decidedAt = at
        // The first step that drew the threshold fixes the crossing: the urge reaches it at the deadline.
        else if (deadline === null && state.threshold !== null)
          deadline = nextIdleDeadline(state, view, at + dt)
      }
      expect(deadline, `seed ${seed}`).not.toBeNull()
      expect(decidedAt, `seed ${seed}`).not.toBeNull()
      // The grid decides at the step whose span reaches the crossing.
      expect(decidedAt!, `seed ${seed}`).toBeGreaterThanOrEqual(deadline! - dt - 1e-9)
      expect(decidedAt!, `seed ${seed}`).toBeLessThan(deadline! + 1e-9)
    }
  })

  it('frees an errand at its refractory deadline when the subtraction rounds short of it', () => {
    // `since + refractory` lands on `at` while `at - since` stays below the refractory. A refractory check written as the
    // subtraction kept the errand out at its own deadline, so that deadline stayed due at `at` and a wake there never moved on.
    const since = 7784.220062792753
    const at = since + 600
    expect(at - since).toBeLessThan(600)
    const view: IdleView = { drive: { ...neutralDrive, body: true, errands: ['wander'] }, active: true, mode: 'idle', away: false, blocked: false, current: { seq: 1, kind: 'sigh' }, errand: null }
    const state = { ...initialIdleSchedule(), threshold: 3, urge: 0, errandStarts: { wander: since }, errandListedSince: { wander: 0 } }
    expect(nextIdleDeadline(state, view, at)).toBeGreaterThan(at)
  })

  it('decides nothing under the dormant view and names no deadline', () => {
    const random = createRandomStream(1)
    const result = advanceIdleSchedule(initialIdleSchedule(), dormantIdleView(true), { music: false, settled: false }, 0, 3600, random)
    expect(result.decision).toBeNull()
    expect(nextIdleDeadline(result.state, dormantIdleView(true), 3600)).toBeNull()
  })

  it('compares drives by value', () => {
    expect(sameIdleDrive(neutralDrive, { ...neutralDrive })).toBe(true)
    expect(sameIdleDrive({ ...neutralDrive, errands: ['pastime'] }, { ...neutralDrive, errands: ['pastime'] })).toBe(true)
    expect(sameIdleDrive(neutralDrive, { ...neutralDrive, errands: [] })).toBe(false)
    expect(sameIdleDrive(neutralDrive, { ...neutralDrive, rate: 0 })).toBe(false)
    expect(sameIdleDrive(neutralDrive, null)).toBe(false)
    expect(sameIdleDrive(null, null)).toBe(true)
  })
})
