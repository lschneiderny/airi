/// <reference types="node" />
import type { LivelinessTrace, ParameterRanges } from '../src/composables/live2d/natural-motion/liveliness'

import process from 'node:process'

import { readFile } from 'node:fs/promises'

import { errorMessageFrom } from '@moeru/std'

import { scoreLiveliness } from '../src/composables/live2d/natural-motion/liveliness'

try {
  const args = process.argv.slice(2)
  const mode = args.includes('--reference') ? 'reference' : 'generated'
  const paths = args.filter(arg => arg !== '--reference')
  const path = paths[0]
  if (!path || paths.length !== 1)
    throw new Error('Usage: score-natural-trace.ts [--reference] <trace.json>')
  const input = JSON.parse(await readFile(path, 'utf8')) as LivelinessTrace & { ranges: ParameterRanges }
  if (!Array.isArray(input.t) || !input.channels || !input.ranges)
    throw new Error('Expected trace { t: seconds[], channels, ranges, valid? }.')
  const report = scoreLiveliness(input, input.ranges, { mode })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = report.pass ? 0 : 1
}
catch (error) {
  console.error(`Cannot score trace: ${errorMessageFrom(error) ?? 'Unknown error'}`)
  process.exitCode = 1
}
