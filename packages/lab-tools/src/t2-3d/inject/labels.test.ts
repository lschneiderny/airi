import type { VerdictFile } from '../verdicts'
import type { LabelledCase } from './labels'

import { describe, expect, it } from 'vitest'

import { scoreCase, sealFor, sealRefusals } from './labels'

const LABELS = 'a'.repeat(64)
const TRACE = 'b'.repeat(64)
const sources = [{ source: 'runs/speak-1', traceSha256: TRACE }]
const sealed = sealFor(LABELS, sources, new Date('2026-11-14T00:00:00Z'))

describe('inject seal rule', () => {
  it('lets scoring go ahead only when the labels file and every source trace hash as sealed', () => {
    expect(sealRefusals(sealed, LABELS, sources)).toEqual([])
  })

  it('refuses without a seal, after the labels file changed, and after a source trace changed or was added', () => {
    expect(sealRefusals(null, LABELS, sources)).toHaveLength(1)
    expect(sealRefusals(sealed, 'c'.repeat(64), sources)).toHaveLength(1)
    expect(sealRefusals(sealed, LABELS, [{ source: 'runs/speak-1', traceSha256: 'd'.repeat(64) }])).toHaveLength(1)
    expect(sealRefusals(sealed, LABELS, [...sources, { source: 'runs/walk-1', traceSha256: TRACE }])).toHaveLength(1)
  })
})

function verdict(lines: Record<string, [string, string]>, overall: VerdictFile['verdict'] = 'PASS'): VerdictFile {
  return {
    kind: 'motion3d-verdict',
    version: 1,
    command: 'pops',
    report: 'pops',
    reportVersion: 2,
    verdict: overall,
    exitCode: overall === 'PASS' ? 0 : overall === 'FAIL' ? 1 : 2,
    refusals: overall === 'REFUSED' ? ['refused'] : [],
    inputs: [],
    lines: Object.entries(lines).map(([id, [status, value]]) => ({ run: 'r', id, status, value, rule: '' })),
  }
}

const labelled = (lines: LabelledCase['expect']['lines']): LabelledCase => ({ id: 'c', source: 's', operations: [], report: { command: 'pops' }, expect: { lines } })

describe('inject scoring', () => {
  it('reads an unchanged line as changed when its value moved, even with the same status', () => {
    const before = verdict({ 'upper-body-pops': ['PASS', '0 pops'] })
    expect(scoreCase(labelled({ 'upper-body-pops': 'unchanged' }), verdict({ 'upper-body-pops': ['PASS', '0 pops'] }), before)[0].match).toBe(true)
    expect(scoreCase(labelled({ 'upper-body-pops': 'unchanged' }), verdict({ 'upper-body-pops': ['PASS', '1 pops'] }), before)[0].match).toBe(false)
  })

  it('reads every line of a refused command as REFUSED and a line the verdict lacks as missing', () => {
    const rows = scoreCase(labelled({ 'upper-body-pops': 'FAIL', 'absent': 'unchanged' }), verdict({}, 'REFUSED'), verdict({}))
    expect(rows.map(r => [r.read.split(' ')[0], r.match])).toEqual([['REFUSED', false], ['REFUSED', false]])
    expect(scoreCase(labelled({ absent: 'unchanged' }), verdict({}), verdict({}))[0]).toMatchObject({ read: 'missing', match: false })
  })
})
