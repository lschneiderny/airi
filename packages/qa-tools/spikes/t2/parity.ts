/**
 * T2 spike parity diff. Compares every post-physics parameter of every frame between two runs.
 *
 * Usage (from packages/qa-tools):
 *   tsx spikes/t2/parity.ts <reference.json> <candidate.json> --out <parity.json>
 */
import process from 'node:process'

import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

interface RunFile {
  side: string
  physics: boolean
  deform?: boolean
  parameterIds: string[]
  frames: number[][]
}

/** Criterion (b) of the spike: maximum absolute per-parameter difference over 600 frames. */
const parityThreshold = 1e-5

function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } })
  const [referencePath, candidatePath] = positionals
  if (!referencePath || !candidatePath || !values.out)
    throw new Error('Usage: parity.ts <reference.json> <candidate.json> --out <parity.json>')
  const reference = JSON.parse(readFileSync(referencePath, 'utf8')) as RunFile
  const candidate = JSON.parse(readFileSync(candidatePath, 'utf8')) as RunFile

  if (reference.parameterIds.join('\n') !== candidate.parameterIds.join('\n'))
    throw new Error('The runs list different parameter ids; they did not load the same rig.')
  if (reference.frames.length !== candidate.frames.length || reference.frames.length === 0)
    throw new Error(`Frame counts differ or are empty: ${reference.frames.length} vs ${candidate.frames.length}`)

  const perParameter = reference.parameterIds.map(id => ({ id, maxAbs: 0, frame: -1 }))
  let maxAbs = 0
  let at = { id: '', frame: -1, reference: 0, candidate: 0 }
  let comparedValues = 0
  let identicalValues = 0
  for (let frame = 0; frame < reference.frames.length; frame++) {
    const a = reference.frames[frame]
    const b = candidate.frames[frame]
    for (let index = 0; index < a.length; index++) {
      const diff = Math.abs(a[index] - b[index])
      comparedValues++
      if (diff === 0)
        identicalValues++
      if (diff > perParameter[index].maxAbs)
        perParameter[index] = { id: perParameter[index].id, maxAbs: diff, frame }
      if (diff > maxAbs) {
        maxAbs = diff
        at = { id: reference.parameterIds[index], frame, reference: a[index], candidate: b[index] }
      }
    }
  }

  // Parameters that move at all in the reference run; a parity of 0 on a frozen rig would prove nothing.
  const moving = reference.parameterIds.filter((_, index) => {
    let low = Infinity
    let high = -Infinity
    for (const values of reference.frames) {
      low = Math.min(low, values[index])
      high = Math.max(high, values[index])
    }
    return high - low > 1e-6
  }).length

  const report = {
    reference: { file: referencePath, side: reference.side, physics: reference.physics, deform: reference.deform ?? true },
    candidate: { file: candidatePath, side: candidate.side, physics: candidate.physics, deform: candidate.deform ?? true },
    frames: reference.frames.length,
    parameters: reference.parameterIds.length,
    movingParameters: moving,
    comparedValues,
    identicalValues,
    maxAbs,
    maxAbsAt: at,
    threshold: parityThreshold,
    withinThreshold: maxAbs <= parityThreshold,
    topParameters: perParameter.filter(entry => entry.maxAbs > 0).sort((x, y) => y.maxAbs - x.maxAbs).slice(0, 10),
  }
  writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`)
  console.info(`maxAbs ${maxAbs} over ${report.frames} frames x ${report.parameters} parameters (${moving} moving); identical ${identicalValues}/${comparedValues}; within ${parityThreshold}: ${report.withinThreshold}`)
}

try {
  main()
}
catch (error) {
  console.error(errorMessageFrom(error) ?? 'Parity diff failed')
  process.exitCode = 1
}
