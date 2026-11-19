import { expect, it } from 'vitest'

import { readStageEvidence } from '../../stage/gates'

it('reads a synthetic stub-runner summary as exactly one walk timeline and one arm run', () => {
  // This is the stub runner's serialized diagnostics payload, without a model
  // or rendered frame-budget measurement. The existing consumer owns parsing.
  const summary = {
    level: 't2-3d',
    model: 'stub-rig',
    frames: 2,
    perFrameSeries: {
      columns: ['t', 'feetMaxError', 'mode', 'skate'],
      rows: [[0, 0.02, 'idle', 0.01], [90000, 0.04, 'walking', 0.03]],
    },
    perFrame: {
      t_ms: [100, 90100],
      penL: [0.002, 0.001],
      penR: [0.003, 0.004],
    },
  }

  const evidence = readStageEvidence('stub/summary.json', JSON.parse(JSON.stringify(summary)))

  expect(evidence).toEqual([
    {
      kind: 'walk',
      source: 'stub/summary.json',
      frames: [
        { mode: 'idle', skate: 0.01, feetMaxError: 0.02 },
        { mode: 'walking', skate: 0.03, feetMaxError: 0.04 },
      ],
    },
    {
      kind: 'arms',
      source: 'stub/summary.json',
      model: 'stub-rig',
      spanMs: 90000,
      penetration: { left: 0.002, right: 0.004 },
      clothContact: null,
    },
  ])
})
