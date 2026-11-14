import type { MatrixFile } from './plan'

import { describe, expect, it } from 'vitest'

import { planMatrix, preflightRefusals, reportArguments, runArguments } from './plan'

const MODEL = '/models/random models/鸣潮_千咲1.02.pmx'

function matrix(reports: MatrixFile['reports']): MatrixFile {
  return {
    kind: 'motion3d-matrix',
    version: 1,
    rigs: { chisa: { env: 'AIRI_QA_MMD_MODEL' } },
    runs: [
      { id: 'speak', rig: 'chisa', scenario: 'speak', seeds: [3, 1, 2], seconds: 60 },
      { id: 'idle', rig: 'chisa', scenario: 'idle', seeds: [1, 2, 3], seconds: 120 },
    ],
    reports,
  }
}

describe('matrix planning', () => {
  it('expands each run group to one run per seed and a group reference to its seeds in declared order', () => {
    const plan = planMatrix(matrix([{ id: 'timing', command: 'gesture-timing', runs: ['speak'], options: { '--idle': ['idle-s2', 'idle-s1'] }, flags: ['--require', 'a,b'] }]))
    expect(plan.refusals).toEqual([])
    expect(plan.runs.map(run => run.id)).toEqual(['speak-s3', 'speak-s1', 'speak-s2', 'idle-s1', 'idle-s2', 'idle-s3'])
    expect(reportArguments(plan.reports[0], id => `/out dir/runs/${id}`, '/out dir/verdicts/timing.json')).toEqual([
      'gesture-timing',
      '/out dir/runs/speak-s3',
      '/out dir/runs/speak-s1',
      '/out dir/runs/speak-s2',
      '--idle',
      '/out dir/runs/idle-s2',
      '/out dir/runs/idle-s1',
      '--require',
      'a,b',
      '--json',
      '/out dir/verdicts/timing.json',
    ])
  })

  it('keeps a model path with spaces as one run argument', () => {
    const [run] = planMatrix(matrix([])).runs
    expect(runArguments(run, MODEL, '/out/runs/speak-s3')).toEqual(['run', '--model', MODEL, '--scenario', 'speak', '--seed', '3', '--seconds', '60', '--out', '/out/runs/speak-s3'])
  })

  it('refuses a report that names an undeclared run, a group on an undeclared rig, a repeated id and a flag the matrix owns', () => {
    const gate = (id: string, runs: string[], flags?: string[]) => ({ id, command: 'gate' as const, runs, ...(flags ? { flags } : {}) })
    expect(planMatrix(matrix([gate('g', ['speak-s1'])])).refusals).toEqual([])
    expect(planMatrix(matrix([gate('g', ['speak-s9'])])).refusals).toHaveLength(1)
    expect(planMatrix(matrix([gate('g', ['idle']), gate('g', ['speak'])])).refusals).toHaveLength(1)
    expect(planMatrix(matrix([gate('g', ['idle'], ['--json', 'x'])])).refusals).toHaveLength(1)
    const file = matrix([])
    expect(planMatrix({ ...file, runs: [...file.runs, { id: 'walk', rig: 'ellen', scenario: 'walk', seeds: [1] }] }).refusals).toHaveLength(1)
  })
})

describe('matrix preflight', () => {
  const rigs = { chisa: { path: MODEL, exists: true, source: '$AIRI_QA_MMD_MODEL' } }

  it('starts on a clean worktree with every model present and an empty output folder', () => {
    expect(preflightRefusals({ dirty: false, allowDirty: false, rigs, outEntries: [] })).toEqual([])
    expect(preflightRefusals({ dirty: true, allowDirty: true, rigs, outEntries: [] })).toEqual([])
  })

  it('refuses a dirty worktree, an unset or missing model and an output folder that holds anything', () => {
    expect(preflightRefusals({ dirty: true, allowDirty: false, rigs, outEntries: [] })).toHaveLength(1)
    expect(preflightRefusals({ dirty: false, allowDirty: false, rigs: { chisa: { path: null, exists: false, source: '$X' } }, outEntries: [] })).toHaveLength(1)
    expect(preflightRefusals({ dirty: false, allowDirty: false, rigs: { chisa: { ...rigs.chisa, exists: false } }, outEntries: [] })).toHaveLength(1)
    expect(preflightRefusals({ dirty: false, allowDirty: false, rigs, outEntries: ['runs'] })).toHaveLength(1)
  })
})
