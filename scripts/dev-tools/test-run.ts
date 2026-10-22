import process from 'node:process'

import { spawn } from 'node:child_process'

import { errorMessageFrom } from '@moeru/std'

import { repoRoot } from './lib/git'
import { runSuites, summarizeSuites, testRunSuites } from './test-run-plan'

// `pnpm` is a `.cmd` shim on Windows, so each fixed command line runs through the shell.
function runCommand(command: string, cwd: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, stdio: 'inherit', shell: true })
    child.once('error', reject)
    child.once('close', code => resolve(code))
  })
}

async function main(): Promise<number> {
  const root = repoRoot(process.cwd())
  const results = await runSuites(testRunSuites, (suite) => {
    console.info(`\n[test:run] ${suite.label}: ${suite.command}`)
    return runCommand(suite.command, root)
  })
  const summary = summarizeSuites(results)
  console.info(`\n${summary.lines.join('\n')}\ntest:run exit ${summary.exitCode}`)
  return summary.exitCode
}

main().then(code => process.exit(code), (error) => {
  console.error(`test:run broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  process.exit(1)
})
