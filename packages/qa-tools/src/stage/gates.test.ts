import type { GateResult, StageEvidence } from './gates'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatGateResults, gateActionPreempt, gateArmPenetration, gateFrameBudget, gateGestureWalk, gateWalkSkate, readStageEvidence, runStageGates, stageScenarioColumns } from './gates'

// Minimal copies of the plan's real evidence (`.omo/evidence/fullscreen-stage-locomotion/`); each records its `source`.
const fixtureDir = join(import.meta.dirname, '../../fixtures/stage')

function load(...names: string[]): StageEvidence[] {
  return names.flatMap(name => readStageEvidence(name, JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'))))
}

function check(result: GateResult, name: string) {
  const found = result.checks.find(entry => entry.name === name)
  if (!found)
    throw new Error(`no check ${name} in ${formatGateResults([result])}`)
  return found
}

const pairFiles = (phase: 'c' | 'd') => [1, 2, 3].flatMap(n => [`task-1-${phase}-classic-${n}.json`, `task-1-${phase}-spike-${n}.json`])

describe('stage-walk-skate', () => {
  it('passes the todo 10 Chisa walk', () => {
    const result = gateWalkSkate(load('task-10-chisa.json'))

    expect(result.verdict).toBe('PASS')
    expect(check(result, 'task-10-chisa.json skate').detail).toContain('max locomotion.skate 0.00003436 ')
  })

  it('fails a timeline whose planted foot slides 0.05', () => {
    const series = { columns: ['mode', 'skate', 'feetMaxError'], rows: [['walking', 0.01, 0.001], ['walking', 0.05, 0.001], ['idle', 0.2, 0.2]] }

    const result = gateWalkSkate(readStageEvidence('slide', { perFrameSeries: series }))

    expect(result.verdict).toBe('FAIL')
    expect(check(result, 'slide skate').pass).toBe(false)
    expect(check(result, 'slide feet').pass).toBe(true)
  })

  it('fails a timeline without a walking frame', () => {
    const result = gateWalkSkate(readStageEvidence('still', { perFrameSeries: { columns: ['mode', 'skate', 'feetMaxError'], rows: [['idle', 0, 0]] } }))

    expect(result.verdict).toBe('FAIL')
    expect(check(result, 'still walk').detail).toBe('no frame in mode walking')
  })
})

describe('stage-arm-penetration', () => {
  it('passes the todo 11 standing runs of all four rigs, with cloth contact reported only', () => {
    const result = gateArmPenetration(load('task-11-chisa.json', 'task-11-ellen.json', 'task-11-vivian.json', 'task-11-elysia.json'))

    expect(result.verdict).toBe('PASS')
    expect(result.checks).toHaveLength(8)
    expect(check(result, 'vivian penetration').detail).toContain('clothContact max L 0.2766 R 0.3173 (information only)')
  })

  it('fails the todo 11 hang-90 override on every rig and names the depth', () => {
    const result = gateArmPenetration(load('task-11-penetration.json'))

    expect(result.verdict).toBe('FAIL')
    expect(check(result, 'ellen penetration')).toMatchObject({ pass: false, detail: expect.stringContaining('max arms.penetration 0.9252 (left)') })
    expect(check(result, 'chisa penetration')).toMatchObject({ pass: false, detail: expect.stringContaining('0.4711 (right)') })
    expect(['vivian', 'elysia'].every(model => !check(result, `${model} penetration`).pass)).toBe(true)
  })

  it('fails a clean run shorter than 30 s', () => {
    const result = gateArmPenetration(readStageEvidence('short', { model: 'short', perFrame: { t_ms: [0, 29_999], penL: [0, 0], penR: [0, 0] } }))

    expect(result.verdict).toBe('FAIL')
    expect(check(result, 'short standing span').detail).toBe('30 s (needs >= 30 s)')
  })
})

describe('stage-frame-budget', () => {
  it('passes the todo 1 phase D pairs (DPR 1.0 stage cap)', () => {
    const result = gateFrameBudget(load(...pairFiles('d')))

    expect(result.verdict).toBe('PASS')
    expect(check(result, 'fps-ratio').detail).toContain('median desktop/window FPS 1.06 ')
    expect(check(result, 'readback-max-delta').detail).toContain('median (desktop max - window max) -0.1 ms')
  })

  it('fails the FPS ratio of the todo 1 phase C pairs at native DPR', () => {
    const result = gateFrameBudget(load(...pairFiles('c')))

    expect(result.verdict).toBe('FAIL')
    expect(check(result, 'fps-ratio')).toMatchObject({ pass: false, detail: expect.stringContaining('median desktop/window FPS 0.8686 (pairs 0.8485, 0.8686, 1.014') })
    expect(check(result, 'p95-stage-ms').pass).toBe(true)
  })

  it('fails fewer than three pairs', () => {
    const result = gateFrameBudget(load('task-1-d-classic-2.json', 'task-1-d-spike-2.json'))

    expect(check(result, 'pairs')).toMatchObject({ pass: false, detail: '1 window/desktop pairs (needs >= 3)' })
  })

  it('fails runs without hit-test readback', () => {
    const run = (mode: string, n: number) => ({ n, result: { mode, fps: 50, p95StageMs: 1, readbackMs: null, frames: 3000 } })
    const evidence = [1, 2, 3].flatMap(n => [...readStageEvidence(`w${n}`, run('window', n)), ...readStageEvidence(`d${n}`, run('desktop', n))])

    expect(check(gateFrameBudget(evidence), 'readback').pass).toBe(false)
  })
})

type Row = [t: number, mode: string, enabled: boolean, skate: number, feetMaxError: number, performingName: string | null, performingLayer: string | null, performingPhase: string | null, pendingGoal: boolean, goalX: number | null]

/** A synthetic `measure --scenario` record: one row per snapshot, `t` in ms since the playClip post. */
function scenarioRecord(scenario: 'gesture-walk' | 'action-preempt', rows: readonly (readonly unknown[])[], extra: Record<string, unknown> = {}) {
  return {
    kind: 'stage-scenario',
    version: 1,
    scenario,
    clip: scenario === 'gesture-walk' ? 'arms-wave' : 'dance-long',
    seconds: 12,
    stopAtMs: rows.at(-1)![0] as number,
    measurement: { fps: 60, frames: 1200, p95StageMs: 2.1 },
    valid: true,
    series: { columns: [...stageScenarioColumns], rows },
    ...extra,
  }
}

/** 130 snapshots 100 ms apart, walking with arms-wave on the upper layer. */
function gestureRows(edit: (row: Row, index: number) => Row = row => row): Row[] {
  return Array.from({ length: 130 }, (_, index): Row => edit([(index + 1) * 100, index % 40 === 39 ? 'turning' : 'walking', true, 0.001, 0.002, 'arms-wave', 'upper', 'playing', false, 10], index))
}

/**
 * Walk lead-in, 5 settling samples (gait still on by the director's design), 100 playing samples with the gait off, the
 * clear at t 10.6 s and the held goal issued `resumeMs` later.
 */
function preemptRows(options: { resumeMs?: number | null, edit?: (row: Row, index: number) => Row } = {}): Row[] {
  const { resumeMs = 500, edit = row => row } = options
  const rows: Row[] = [[-200, 'walking', true, 0.001, 0.001, null, null, null, false, 10], [-100, 'walking', true, 0.001, 0.001, null, null, null, false, 10]]
  for (let index = 0; index < 5; index += 1)
    rows.push([index * 100, 'walking', true, 0.001, 0.001, 'dance-long', 'full', 'settling', true, null])
  for (let index = 0; index < 100; index += 1)
    rows.push([500 + index * 100, 'idle', false, 0, 0.001, 'dance-long', 'full', 'playing', true, null])
  for (let t = 10_600; t <= 14_000; t += 100) {
    const issued = resumeMs !== null && t >= 10_600 + resumeMs
    rows.push([t, issued ? 'walking' : 'idle', true, 0.001, 0.001, null, null, null, !issued, issued ? 10 : null])
  }
  return rows.map(edit)
}

const gestureWalk = (rows: Row[], extra?: Record<string, unknown>) => gateGestureWalk(readStageEvidence('gw', scenarioRecord('gesture-walk', rows, extra)))
const actionPreempt = (rows: Row[], extra?: Record<string, unknown>) => gateActionPreempt(readStageEvidence('ap', scenarioRecord('action-preempt', rows, extra)))

describe('stage-gesture-walk', () => {
  it('passes an arm clip kept over a 13 s walk', () => {
    const result = gestureWalk(gestureRows())

    expect(result.verdict).toBe('PASS')
    expect(check(result, 'gw walk span').detail).toContain('12.6 s walking with arms-wave on the upper layer')
    expect(check(result, 'gw presence').detail).toContain('130 of 130 samples')
  })

  it('fails a full clip that stops the gait and names the frames', () => {
    const result = gestureWalk(gestureRows((row, index) => index >= 40 && index < 46 ? [row[0], 'idle', false, 0, 0.001, 'legs-step', 'full', 'playing', true, null] : row))

    expect(result.verdict).toBe('FAIL')
    expect(check(result, 'gw gait enabled')).toMatchObject({ pass: false, detail: expect.stringContaining('6 of 130 samples with locomotion.enabled false: #40 (t 4.1 s), #41 (t 4.2 s)') })
  })

  it('fails when the clip is on the upper layer in fewer than 80 % of the samples', () => {
    const result = gestureWalk(gestureRows((row, index) => index % 4 === 0 ? [...row.slice(0, 5), null, null, null, false, 10] as Row : row))

    expect(check(result, 'gw presence')).toMatchObject({ pass: false, detail: expect.stringContaining('97 of 130 samples (74.62 %') })
    expect(check(result, 'gw gait enabled').pass).toBe(true)
  })

  it('fails a planted foot that slides 0.05 and a walk shorter than the scenario span', () => {
    const result = gestureWalk(gestureRows((row, index) => index === 7 ? [row[0], row[1], true, 0.05, row[4], ...row.slice(5)] as Row : row).slice(0, 60))

    expect(check(result, 'gw skate').pass).toBe(false)
    expect(check(result, 'gw feet').pass).toBe(true)
    expect(check(result, 'gw walk span')).toMatchObject({ pass: false, detail: expect.stringContaining('5.8 s walking') })
  })

  it('fails a record measured under concurrent load', () => {
    expect(check(gestureWalk(gestureRows(), { valid: false }), 'gw load')).toMatchObject({ pass: false, detail: 'INVALID-CONCURRENT-LOAD' })
  })
})

describe('stage-action-preempt', () => {
  it('passes a dance that holds the goal and resumes it, excluding settling samples from the gait check', () => {
    const result = actionPreempt(preemptRows())

    expect(result.verdict).toBe('PASS')
    expect(check(result, 'ap performance').detail).toBe('105 samples performing dance-long on the full layer: 100 playing, 5 settling (settling keeps the gait on and is not gated)')
    expect(check(result, 'ap goal resume').detail).toContain('goal issued 0.5 s after action.performing cleared')
  })

  it('fails a playing sample with the gait on and names it', () => {
    const result = actionPreempt(preemptRows({ edit: (row, index) => index === 7 ? [row[0], 'walking', true, ...row.slice(3)] as Row : row }))

    expect(result.verdict).toBe('FAIL')
    expect(check(result, 'ap gait off while playing')).toMatchObject({ pass: false, detail: expect.stringContaining('1 of 100 playing samples with locomotion.enabled true: #7 (t 0.5 s)') })
  })

  it('fails a playing sample without a pending goal', () => {
    const result = actionPreempt(preemptRows({ edit: (row, index) => index === 50 ? [...row.slice(0, 8), false, null] as Row : row }))

    expect(check(result, 'ap pending goal')).toMatchObject({ pass: false, detail: expect.stringContaining('#50') })
  })

  it('fails a goal resumed later than 3 s or never', () => {
    expect(check(actionPreempt(preemptRows({ resumeMs: 3_100 })), 'ap goal resume')).toMatchObject({ pass: false, detail: expect.stringContaining('3.1 s') })
    expect(check(actionPreempt(preemptRows({ resumeMs: null })), 'ap goal resume')).toMatchObject({ pass: false, detail: 'no goal issued after action.performing cleared at t 10.6 s' })
  })

  it('fails the stage budget and a run in which the clip never played', () => {
    expect(check(actionPreempt(preemptRows(), { measurement: { fps: 60, frames: 1200, p95StageMs: 4.5 } }), 'ap p95-stage-ms').pass).toBe(false)
    const refused = actionPreempt(preemptRows({ edit: row => [...row.slice(0, 5), null, null, null, false, row[9]] as Row }))
    expect(check(refused, 'ap performance')).toMatchObject({ pass: false, detail: 'no sample performing dance-long on the full layer' })
  })
})

describe('scenario records', () => {
  it('feed only the scenario gates', () => {
    const results = runStageGates(readStageEvidence('gw', scenarioRecord('gesture-walk', gestureRows())))

    expect(results.map(result => `${result.id}: ${result.verdict}`)).toEqual([
      'stage-walk-skate: NO INPUT',
      'stage-arm-penetration: NO INPUT',
      'stage-frame-budget: NO INPUT',
      'stage-gesture-walk: PASS',
      'stage-action-preempt: NO INPUT',
    ])
  })

  it('refuse an unknown scenario and a malformed row', () => {
    expect(() => readStageEvidence('x', scenarioRecord('gesture-walk', gestureRows(), { scenario: 'moonwalk' }))).toThrow('x: scenario must be gesture-walk or action-preempt')
    const rows: unknown[][] = gestureRows()
    rows[3] = [400, 'walking', 'yes', 0, 0, null, null, null, false, null]
    expect(() => readStageEvidence('x', scenarioRecord('gesture-walk', rows))).toThrow('x: series row 3 is malformed')
  })
})

describe('readStageEvidence', () => {
  it('reads every run of a pairs file', () => {
    const runs = pairFiles('d').map(name => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')))

    expect(gateFrameBudget(readStageEvidence('pairs', { runs })).verdict).toBe('PASS')
  })

  it('refuses unknown and malformed evidence', () => {
    expect(() => readStageEvidence('empty', {})).toThrow('empty: no stage gate input')
    expect(() => readStageEvidence('bad', { result: { mode: 'spike', fps: 'fast' } })).toThrow('bad: result is not a measured run')
    expect(() => readStageEvidence('cols', { perFrameSeries: { columns: ['mode'], rows: [] } })).toThrow('needs the columns mode, skate and feetMaxError')
    expect(() => readStageEvidence('list', [])).toThrow('evidence must be a JSON object')
  })
})
