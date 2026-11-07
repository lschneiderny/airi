import { resolve } from 'node:path'
import { argv, exit, stderr, stdout } from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { setupCubism } from '../src/env/setup'

const usage = 'Usage: pnpm qa:setup cubism [--force]\n'
let force = false
try {
  const parsed = parseArgs({
    args: argv.slice(2),
    options: { force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
    strict: true,
  })
  if (parsed.values.help) {
    stdout.write(usage)
    exit(0)
  }
  if (parsed.positionals.length !== 1 || parsed.positionals[0] !== 'cubism') {
    stderr.write(usage)
    exit(2)
  }
  force = parsed.values.force ?? false
}
catch (error) {
  stderr.write(`qa-tools setup: ${errorMessageFrom(error) ?? 'invalid arguments'}\n${usage}`)
  exit(2)
}

setupCubism(resolve(import.meta.dirname, '../../..'), force).then((messages) => {
  stdout.write(`${messages.join('\n')}\n`)
}).catch((error) => {
  stderr.write(`qa-tools setup: ${errorMessageFrom(error) ?? 'download failed'}\n`)
  exit(1)
})
