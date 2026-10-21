/// <reference types="node" />
import type { LivelinessGate } from '../src/composables/live2d/natural-motion/gates'
import type { LivelinessTrace, ParameterRanges } from '../src/composables/live2d/natural-motion/liveliness'

import process from 'node:process'

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { errorMessageFrom } from '@moeru/std'

import { naturalIdleLivelinessGate } from '../src/composables/live2d/natural-motion/gates'
import { aggregateLivelinessReports, scoreLiveliness } from '../src/composables/live2d/natural-motion/liveliness'

/** Committed liveliness gates this CLI can score; the id is the `--gate` value. */
const gates: Record<string, LivelinessGate> = { [naturalIdleLivelinessGate.id]: naturalIdleLivelinessGate }
/** Captures count as equal-duration when their spans (last minus first timestamp) differ by at most this many seconds. */
const durationToleranceSeconds = 1
const usage = 'Usage: score-natural-captures.ts --gate <gate id> <trace1.json> <trace2.json> <trace3.json> [...]'
const gatesFile = fileURLToPath(new URL('../src/composables/live2d/natural-motion/gates.ts', import.meta.url))

/** Last commit that changed the gate file, so the output names the exact committed rules; `null` outside git or before the first commit. */
function gateFileSha(): string | null {
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%H', '--', gatesFile], { cwd: dirname(gatesFile), encoding: 'utf8' }).trim()
    return sha || null
  }
  catch {
    return null
  }
}

try {
  const [option, gateId, ...paths] = process.argv.slice(2)
  if (option === '--prereg')
    throw new Error(`--prereg was replaced by committed gates. Pass --gate ${naturalIdleLivelinessGate.id} instead. ${usage}`)
  if (option !== '--gate' || !gateId || paths.length < 3)
    throw new Error(`A gate id and at least 3 traces are required. ${usage}`)
  const gate = gates[gateId]
  if (!gate)
    throw new Error(`Unknown gate "${gateId}". Valid gates: ${Object.keys(gates).join(', ')}.`)

  const reports = []
  const durations: number[] = []
  for (const path of paths) {
    const input = JSON.parse(await readFile(path, 'utf8')) as LivelinessTrace & { ranges: ParameterRanges }
    if (!Array.isArray(input.t) || input.t.length < 2
      || !input.t.every(time => typeof time === 'number' && Number.isFinite(time))
      || !input.channels || typeof input.channels !== 'object' || Array.isArray(input.channels)
      || !Object.values(input.channels).every(values => Array.isArray(values) && values.length === input.t.length && values.every(Number.isFinite))
      || !input.ranges || typeof input.ranges !== 'object'
      || (input.valid !== undefined && (!Array.isArray(input.valid) || input.valid.length !== input.t.length || !input.valid.every(value => typeof value === 'boolean')))) {
      throw new Error(`Expected trace { t: seconds[], channels, ranges, valid? }: ${path}`)
    }
    durations.push(input.t[input.t.length - 1] - input.t[0])
    reports.push(scoreLiveliness(input, input.ranges, { mode: 'generated' }))
  }
  if (durations.some(duration => Math.abs(duration - durations[0]) > durationToleranceSeconds))
    throw new Error(`Captures must have equal durations (within ${durationToleranceSeconds} s); got ${durations.map(duration => duration.toFixed(2)).join(', ')} s.`)

  const aggregate = aggregateLivelinessReports(reports)
  // The gate passes on its own metrics, exactly as the liveliness gate test judges them; other metrics are reported only.
  const failures = [
    ...aggregate.hardFailures.map(failure => `hard:${failure}`),
    ...gate.metrics
      .filter(id => aggregate.metrics[id]?.pass !== true)
      .map(id => `${id}=${aggregate.metrics[id]?.value ?? null} band=${JSON.stringify(aggregate.metrics[id]?.band ?? null)}`),
  ]
  const output = {
    gate: { id: gate.id, version: gate.version, fileSha: gateFileSha() },
    limitation: gate.limitation,
    pass: failures.length === 0,
    failures,
    durations,
    aggregate,
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  process.exitCode = output.pass ? 0 : 1
}
catch (error) {
  console.error(`Cannot score captures (gate/input error): ${errorMessageFrom(error) ?? 'Unknown error'}`)
  process.exitCode = 2
}
