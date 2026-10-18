/// <reference types="node" />
import type { LivelinessTrace, ParameterRanges } from '../src/composables/live2d/natural-motion/liveliness'

import process from 'node:process'

import { readFile, stat } from 'node:fs/promises'

import { errorMessageFrom } from '@moeru/std'

import { aggregateLivelinessReports, scoreLiveliness } from '../src/composables/live2d/natural-motion/liveliness'

try {
  const [option, preregPath, ...paths] = process.argv.slice(2)
  if (option !== '--prereg' || !preregPath || paths.length < 3)
    throw new Error('Preregistration required. Usage: score-natural-captures.ts --prereg <prereg.json> <trace1.json> <trace2.json> <trace3.json> [...]')

  const prereg = JSON.parse(await readFile(preregPath, 'utf8')) as {
    createdAt?: unknown
    gate?: unknown
    rig?: unknown
    captureCount?: unknown
    durations?: unknown
  }
  const createdAt = typeof prereg?.createdAt === 'string' ? Date.parse(prereg.createdAt) : Number.NaN
  const durations = prereg?.durations
  if (!Number.isFinite(createdAt)
    || typeof prereg?.gate !== 'string' || !prereg.gate.trim()
    || typeof prereg.rig !== 'string' || !prereg.rig.trim()
    || prereg.captureCount !== paths.length
    || !Array.isArray(durations) || durations.length !== paths.length
    || !durations.every(duration => typeof duration === 'number' && Number.isFinite(duration) && duration > 0)
    || !durations.every(duration => duration === durations[0])) {
    throw new Error('Preregistration must list createdAt, gate, rig, captureCount matching the inputs, and equal positive durations in seconds for every capture.')
  }
  // File modification times bind the declared preregistration to data captured later.
  for (const path of paths) {
    if (createdAt >= (await stat(path)).mtimeMs)
      throw new Error(`Preregistration ${preregPath} must be created before trace ${path}.`)
  }

  const reports = []
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
    reports.push(scoreLiveliness(input, input.ranges, { mode: 'generated' }))
  }
  const aggregate = aggregateLivelinessReports(reports)
  process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`)
  process.exitCode = aggregate.pass ? 0 : 1
}
catch (error) {
  console.error(`Cannot score captures (preregistration/input error): ${errorMessageFrom(error) ?? 'Unknown error'}`)
  process.exitCode = 2
}
