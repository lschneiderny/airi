import process from 'node:process'

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { writeReport } from '../src/report/render'

const USAGE = `Usage: report <runDir> [<runDir>...] [--out <file>]

Writes a self-contained review report to <firstRunDir>/report.html (or --out).
Run dirs may be gate runs (report.json), T3 runs (scenario.json, screenshots.json) or qa:test runs (summary.json).`

/** Exit codes: 0 written with every input usable, 1 written but an input was missing or unreadable, 2 usage error. */
function main(argv: string[]): number {
  let values: { out?: string }
  let positionals: string[]
  try {
    ({ values, positionals } = parseArgs({ args: argv, options: { out: { type: 'string' } }, allowPositionals: true, strict: true }))
  }
  catch (error) {
    console.error(`${errorMessageFrom(error) ?? 'unknown error'}\n${USAGE}`)
    return 2
  }
  if (positionals.length === 0) {
    console.error(USAGE)
    return 2
  }

  const runDirs = positionals.map(dir => resolve(dir))
  const rendered = writeReport({ runDirs, outFile: values.out ? resolve(values.out) : undefined })
  console.info(`report written to ${rendered.outFile} (${Math.round(rendered.html.length / 1024)} KiB)`)
  for (const issue of rendered.issues)
    console.error(`input problem: ${issue.run}/${issue.file}: ${issue.problem}`)
  if (rendered.visualCheck.length)
    console.info(`for your visual check: ${rendered.visualCheck.join(', ')}`)
  return rendered.issues.length ? 1 : 0
}

process.exitCode = main(process.argv.slice(2))
