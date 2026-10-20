import type { DoctorRow } from '../src/env/doctor'

import { resolve } from 'node:path'
import { argv, exit, stderr, stdout } from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { createSystemProbes, runDoctor, runWarm, spawnWarmRun } from '../src/env/doctor'

const usage = `Usage: pnpm qa:doctor [--json] [--warm]

Reports whether this checkout is ready for QA runs. Exits 1 when any check fails, 0 otherwise.
  --json   print rows as JSON instead of a table
  --warm   also run the stage-ui blink-ownership browser test once to warm the Vite optimizer
`

function printTable(rows: DoctorRow[]) {
  const idWidth = Math.max(...rows.map(row => row.id.length))
  for (const row of rows) {
    stdout.write(`${row.status.toUpperCase().padEnd(4)}  ${row.id.padEnd(idWidth)}  ${row.detail}\n`)
    if (row.fix)
      stdout.write(`${' '.repeat(idWidth + 8)}fix: ${row.fix}\n`)
  }
}

let flags: { json?: boolean, warm?: boolean, help?: boolean }
try {
  flags = parseArgs({
    args: argv.slice(2),
    options: { json: { type: 'boolean' }, warm: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    strict: true,
    allowPositionals: false,
  }).values
}
catch (error) {
  stderr.write(`qa-tools doctor: ${errorMessageFrom(error) ?? 'invalid arguments'}\n\n${usage}`)
  exit(2)
}

if (flags.help) {
  stdout.write(usage)
  exit(0)
}

async function main(options: { json?: boolean, warm?: boolean }) {
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
  const rows = await runDoctor(createSystemProbes(repoRoot))
  if (options.warm)
    rows.push(await runWarm(() => spawnWarmRun(repoRoot)))

  if (options.json)
    stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
  else
    printTable(rows)

  exit(rows.some(row => row.status === 'fail') ? 1 : 0)
}

main(flags).catch((error) => {
  stderr.write(`qa-tools doctor: ${errorMessageFrom(error) ?? 'unexpected failure'}\n`)
  exit(1)
})
