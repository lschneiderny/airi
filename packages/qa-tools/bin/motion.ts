import process from 'node:process'

import { resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { gateUsage, runGateCli } from '../src/motion/gate/cli'
import { runValidateCli, validateUsage } from '../src/motion/validation/cli'
import { t3Usage } from '../src/t3/args'
import { runT3Cli } from '../src/t3/cli'

const usage = `Usage: motion <command>

Commands:
  gate <emotion | liveliness> --level <t1 | t2 | t3> ...   run a committed QA gate
  t3 --rig forbooth --scenario <spec>          run a scenario in the rendered Electron app through the motion QA bridge
  validate-scorer --level t1 ...               validate the emotion scorer itself

${gateUsage}
${t3Usage}

${validateUsage}`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
  if (command === 'gate')
    return runGateCli(rest, repoRoot)
  if (command === 't3')
    return runT3Cli(rest, repoRoot)
  if (command === 'validate-scorer')
    return runValidateCli(rest, repoRoot)
  console.error(command === undefined || command === '--help' ? usage : `Unknown command ${JSON.stringify(command)}\n${usage}`)
  return command === '--help' ? 0 : 2
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
}, (error) => {
  console.error(`qa-tools motion: ${errorMessageFrom(error) ?? 'unexpected failure'}`)
  process.exitCode = 1
})
