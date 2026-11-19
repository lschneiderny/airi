import type { VerdictFile } from '../verdicts'
import type { CommandRecord, MatrixReceipt } from './receipt'

import { describe, expect, it } from 'vitest'

import { compareReceipts, receiptExitCode, reportErrors, summarizeVerdict } from './receipt'

function verdict(exitCode: number, runs: readonly string[], failing: readonly string[] = []): VerdictFile {
  return {
    kind: 'motion3d-verdict',
    version: 1,
    command: 'gate',
    report: 'mmd-motion-quality',
    reportVersion: 5,
    verdict: exitCode === 0 ? 'PASS' : exitCode === 1 ? 'FAIL' : 'REFUSED',
    exitCode,
    refusals: [],
    inputs: runs.map(run => ({ run, commit: null, modelSha256: null, scenario: null, seed: null })),
    lines: failing.map(id => ({ run: runs[0], id, status: 'FAIL', value: '', rule: '' })),
  }
}

function report(id: string, exitCode: number, failing: readonly string[] = []): CommandRecord {
  return { id, kind: 'report', criterion: null, argv: [], exitCode, durationMs: 0, verdict: summarizeVerdict(`${id}.json`, verdict(exitCode, ['/o/runs/a-s1'], failing)), errors: [] }
}

function receipt(commands: CommandRecord[]): MatrixReceipt {
  return { kind: 'motion3d-matrix-receipt', version: 1, matrix: { path: 'm', sha256: '' }, commit: 'c', dirty: false, allowDirty: false, startedAt: '', endedAt: '', rigs: {}, runsFrom: null, memory: '', failOn: [], commands, exitCode: 0 }
}

describe('matrix receipt', () => {
  it('records an error for a missing verdict, a verdict whose exit code is not the command\'s, and a judged folder the command was not given', () => {
    expect(reportErrors(1, verdict(1, ['/o/runs/a-s1']), ['/o/runs/a-s1'])).toEqual([])
    expect(reportErrors(1, 'ENOENT', ['/o/runs/a-s1'])).toHaveLength(1)
    expect(reportErrors(0, verdict(1, ['/o/runs/a-s1']), ['/o/runs/a-s1'])).toHaveLength(1)
    expect(reportErrors(1, verdict(1, ['/elsewhere/a-s1']), ['/o/runs/a-s1'])).toHaveLength(1)
  })

  it('exits 0 on read verdicts whatever they say, and 1 on an error or a verdict --fail-on names', () => {
    expect(receiptExitCode([report('g', 1, ['coverage.arms'])], [])).toBe(0)
    expect(receiptExitCode([report('g', 1, ['coverage.arms'])], ['FAIL'])).toBe(1)
    expect(receiptExitCode([{ ...report('g', 0), errors: ['no readable verdict file'] }], [])).toBe(1)
  })

  it('compares exit code, verdict and failing lines per command, and a command one side lacks', () => {
    const then = receipt([report('g', 1, ['coverage.arms']), report('h', 0)])
    expect(compareReceipts(then, then).every(row => row.same)).toBe(true)
    const rows = compareReceipts(then, receipt([report('g', 1, ['coverage.core']), report('k', 0)]))
    expect(rows.map(row => [row.id, row.same])).toEqual([['g', false], ['h', false], ['k', false]])
  })
})
