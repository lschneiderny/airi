/// <reference types="node" />
import process from 'node:process'

import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { createDecider, parseAffectTrace, replayAffectTrace } from '@proj-airi/stage-shared/expression-performance'

try {
  const { values, positionals } = parseArgs({
    options: { decider: { type: 'string' }, mode: { type: 'string' }, seed: { type: 'string' } },
    allowPositionals: true,
  })
  if (values.decider !== 'picker' || (values.mode !== 'exact' && values.mode !== 'compare') || positionals.length !== 1)
    throw new Error('Usage: replay-affect-trace.ts --decider picker --mode exact|compare [--seed N] <trace.json>')
  const seed = Number(values.seed ?? 1)
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF)
    throw new Error('Seed must be a uint32')
  const trace = parseAffectTrace(JSON.parse(await readFile(positionals[0], 'utf8')))
  const decisions = replayAffectTrace(trace, { ...createDecider(values.decider), kind: values.decider }, values.mode === 'exact' ? { mode: 'exact' } : { mode: 'compare', seed })
  const episodesByBand = { slight: 0, clear: 0, strong: 0 }
  const expressions: Record<string, number> = {}
  const changes: number[] = []
  for (const { at, decision } of decisions) {
    for (const episode of decision.episodes)
      episodesByBand[episode.band]++
    for (const slot of decision.slots) {
      changes.push(at)
      if (slot.expressionId !== null)
        expressions[slot.expressionId] = (expressions[slot.expressionId] ?? 0) + 1
    }
  }
  let slotChangesPer5sMax = 0
  let start = 0
  for (let end = 0; end < changes.length; end++) {
    while (changes[end] - changes[start] >= 5)
      start++
    slotChangesPer5sMax = Math.max(slotChangesPer5sMax, end - start + 1)
  }
  process.stdout.write(`${JSON.stringify({ decider: values.decider, decisions, summary: { episodesByBand, slotChanges: changes.length, slotChangesPer5sMax, expressions } }, null, 2)}\n`)
}
catch (error) {
  console.error(`Cannot replay affect trace: ${errorMessageFrom(error) ?? 'Unknown error'}`)
  process.exitCode = 1
}
