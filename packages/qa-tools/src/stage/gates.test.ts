import type { GateResult, StageEvidence } from './gates'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatGateResults, gateArmPenetration, gateFrameBudget, gateWalkSkate, readStageEvidence } from './gates'

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
