import process from 'node:process'

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { modelUsage, runModelCli } from '../src/model/cli'

const args = process.argv.slice(2)

// Only the dispatcher part (leading flags plus the subcommand) is parsed here;
// everything after the subcommand belongs to that subcommand's own parser.
const subcommandIndex = args.findIndex(arg => !arg.startsWith('-'))
const dispatcherArgs = subcommandIndex === -1 ? args : args.slice(0, subcommandIndex + 1)

let help: boolean | undefined
try {
  help = parseArgs({
    args: dispatcherArgs,
    options: { help: { type: 'boolean', short: 'h' } },
    strict: true,
    allowPositionals: true,
  }).values.help
}
catch (error) {
  process.stderr.write(`qa-tools model: ${errorMessageFrom(error) ?? 'invalid arguments'}\n\n${modelUsage}`)
  process.exit(2)
}

if (help) {
  process.stdout.write(modelUsage)
  process.exit(0)
}

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')

runModelCli(args, repoRoot, process.env).then((code) => {
  process.exitCode = code
}, (error) => {
  process.stderr.write(`qa-tools model: ${errorMessageFrom(error) ?? 'unexpected failure'}\n`)
  process.exitCode = 1
})
