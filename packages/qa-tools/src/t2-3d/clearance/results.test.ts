import type { Motion3dClearance } from './measure'
import type { ClearanceRow } from './results'

import { describe, expect, it } from 'vitest'

import { clearanceRow, formatComparison, formatResults, modelsFromList, modelsFromPaths, rigsAbove } from './results'

function row(label: string, scenario: string, piercedShare: number | null): ClearanceRow {
  const classes = { 'upper-rigid': 0, 'upper-cloth': 0, 'lower-rigid': 0, 'lower-cloth': 0, 'head-rigid': 0, 'hair': 0 }
  const clearance: Motion3dClearance | null = piercedShare === null
    ? null
    : {
        sampledFrames: 10,
        sampleStep: 2,
        triangles: { tested: 1, worn: 0, structural: 0, byClass: classes },
        sleeveRatio: { upper: 0.2, fore: 0.2 },
        piercedShare,
        byClass: { ...classes, 'upper-cloth': piercedShare },
        bySegment: { upperArm: 0, forearm: piercedShare, hand: 0 },
        topMaterials: [],
        depth: { median: 0, p90: 0, deepShare: 0 },
        episodes: { count: 0, longestSeconds: 0 },
        upperArmDeg: { mean: 20, p10: 15, p90: 25 },
        cloth: { travelMedian: 0, travelP99: 0, reversalMean: 0.01 },
      }
  return { label, scenario, run: `runs/${label}--${scenario}`, exitCode: clearance ? 0 : 1, error: clearance ? null : 'the run wrote no summary', assetSha256: null, noClearPoseTicks: clearance ? 0 : null, clearance }
}

describe('clearance models', () => {
  it('labels a folder\'s models by file stem, in path order, and numbers a repeated stem', () => {
    expect(modelsFromPaths(['/models/b/rig.pmx', '/models/a/rig.PMX', '/models/a/notes.txt', '/models/c/other.pmx'])).toEqual([
      { path: '/models/a/rig.PMX', label: 'rig' },
      { path: '/models/b/rig.pmx', label: 'rig-2' },
      { path: '/models/c/other.pmx', label: 'other' },
    ])
  })

  it('never gives two models one label when a file stem already ends in a number', () => {
    expect(modelsFromPaths(['/models/a/rig.pmx', '/models/b/rig.pmx', '/models/c/rig-2.pmx']).map(model => model.label)).toEqual(['rig', 'rig-3', 'rig-2'])
    // A label names a folder, and the macOS volume folds case.
    expect(modelsFromPaths(['/models/a/Rig.pmx', '/models/b/rig.pmx']).map(model => model.label)).toEqual(['Rig', 'rig-2'])
    expect(modelsFromPaths(['/models/a/Caf\u00E9.pmx', '/models/b/Cafe\u0301.pmx']).map(model => model.label)).toEqual(['Caf\u00E9', 'Cafe\u0301-2'])
    expect(() => modelsFromList('/a.pmx\tSame\n/b.pmx\tsame\n', '/lists')).toThrow('same')
  })

  it('reads a list of paths with optional tab-separated labels, relative to the list', () => {
    const text = '# rigs\n/models/a b/rig one.pmx\tfirst\n\nb/rig.pmx\n'
    expect(modelsFromList(text, '/lists')).toEqual([
      { path: '/models/a b/rig one.pmx', label: 'first' },
      { path: '/lists/b/rig.pmx', label: 'rig' },
    ])
    expect(() => modelsFromList('/a.pmx\tsame\n/b.pmx\tsame\n', '/lists')).toThrow('same')
    expect(() => modelsFromList('/a.pmx\tone/two\n', '/lists')).toThrow('path separator')
  })
})

describe('clearance results', () => {
  it('measures a run that exited 1 for ticks without a clear arm pose, and carries the ticks', () => {
    const measured = row('a', 'idle-drive', 0.9).clearance
    const finished = { label: 'a', scenario: 'idle-drive', run: 'runs/a--idle-drive', exitCode: 1 }
    const result = clearanceRow({ ...finished, summary: { provenance: { assetSha256: 'abc' }, collisions: { count: 120 }, clearance: measured } })
    expect(result.clearance).toEqual(measured)
    expect(result.noClearPoseTicks).toBe(120)
    expect(result.error).toBeNull()
    expect(rigsAbove([result], 0.5)).toEqual(['a'])
  })

  it('fails a run that wrote no summary or no clearance block, and names the missing part', () => {
    const finished = { label: 'a', scenario: 'walk', run: 'runs/a--walk', exitCode: 1 }
    expect(clearanceRow({ ...finished, summary: null })).toMatchObject({ clearance: null, error: 'the run wrote no summary', noClearPoseTicks: null })
    expect(clearanceRow({ ...finished, summary: { provenance: {}, collisions: { count: 0 } } })).toMatchObject({ clearance: null, error: 'the summary has no clearance block', noClearPoseTicks: 0 })
    expect(clearanceRow({ ...finished, summary: { collisions: {} } }).error).toBe('summary.json is not a run summary')
  })

  it('names the rigs whose idle-drive pierced share exceeds the bound, and only idle-drive', () => {
    const rows = [row('a', 'idle-drive', 0.5), row('b', 'idle-drive', 0.05), row('c', 'walk', 0.9), row('d', 'idle-drive', null)]
    expect(rigsAbove(rows, 0.05)).toEqual(['a'])
  })

  it('tables a measured row with its ticks without a clear arm pose, and a failed row with its reason', () => {
    const measured = { ...row('a', 'idle-drive', 1), exitCode: 1, noClearPoseTicks: 120 }
    const lines = formatResults([measured, row('b', 'walk', null)]).split('\n')
    expect(lines[1].split(/ {2,}/)).toEqual(['a', 'idle-drive', '100.0', '0.0', '0', '0.0', '20.0', '1.0', '120', '-'])
    expect(lines[2]).toMatch(/^b\s+walk\s+failed \(exit 1\): the run wrote no summary$/)
  })

  it('compares rows by rig and scenario, and names rows found on one side only', () => {
    const before = { kind: 'motion3d-clearance' as const, version: 1 as const, rows: [row('a', 'idle-drive', 1), row('b', 'walk', 0.1)] }
    expect(formatComparison(before, [row('a', 'idle-drive', 0.02), row('c', 'walk', 0)]).split('\n')).toEqual([
      'a idle-drive: pierced 100.0 → 2.0 %, arm 20.0 → 20.0 deg, reversal 1.0 → 1.0 %, no clear pose 0 → 0',
      'c walk: not in the earlier results',
      'b walk: only in the earlier results',
    ])
  })
})
