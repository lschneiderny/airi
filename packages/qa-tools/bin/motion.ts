import process from 'node:process'

import { resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { ClosureHooks } from '../src/motion/cache/closure-hooks'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const closure = new ClosureHooks(repoRoot, import.meta.url)

async function main(argv: string[]): Promise<number> {
  // Static imports execute before the hook installation, so application imports must be dynamic.
  const { gateUsage, runGateCli } = await import('../src/motion/gate/cli')
  const { runValidateCli, validateUsage } = await import('../src/motion/validation/cli')
  const { t3Usage } = await import('../src/t3/args')
  const { runT3Cli } = await import('../src/t3/cli')

  const usage = `Usage: motion <command>

Commands:
  gate <emotion | liveliness> --level <t1 | t2 | t3> ...   run a committed QA gate
  t3 --rig forbooth --scenario <spec>          run a scenario in the rendered Electron app through the motion QA bridge
  validate-scorer --level t1 ...               validate the emotion scorer itself

${gateUsage}
${t3Usage}

${validateUsage}`

  const [command, ...rest] = argv
  if (command === 'gate')
    return runGateCli(rest, repoRoot, process.env, closure)
  if (command === 't3')
    return runT3Cli(rest, repoRoot)
  if (command === 'validate-scorer')
    return runValidateCli(rest, repoRoot, process.env, closure)
  console.error(command === undefined || command === '--help' ? usage : `Unknown command ${JSON.stringify(command)}\n${usage}`)
  return command === '--help' ? 0 : 2
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
}, (error) => {
  console.error(`qa-tools motion: ${errorMessageFrom(error) ?? 'unexpected failure'}`)
  process.exitCode = 1
}).finally(() => closure.stop())
