import process from 'node:process'

import { resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { gateUsage, runGateCli } from '../src/motion/gate/cli'

const usage = `Usage: motion <command>

Commands:
  gate <emotion | liveliness> --level t1 ...   run a committed QA gate

${gateUsage}`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (command === 'gate')
    return runGateCli(rest, resolve(import.meta.dirname, '..', '..', '..'))
  console.error(command === undefined || command === '--help' ? usage : `Unknown command ${JSON.stringify(command)}\n${usage}`)
  return command === '--help' ? 0 : 2
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
}, (error) => {
  console.error(`qa-tools motion: ${errorMessageFrom(error) ?? 'unexpected failure'}`)
  process.exitCode = 1
})
