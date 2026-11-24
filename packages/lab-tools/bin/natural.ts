import process from 'node:process'

import { errorMessageFrom } from '@moeru/std'

import { compareCommand, fingerprintCommand, naturalUsage, referenceCommand, replayCommand } from '../src/natural-fingerprint/cli'

const commands = {
  replay: replayCommand,
  fingerprint: fingerprintCommand,
  reference: referenceCommand,
  compare: compareCommand,
}

const interrupt = new AbortController()
const stop = () => interrupt.abort(new Error('interrupted'))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2)
  if (command === '--help' || command === '-h') {
    process.stdout.write(naturalUsage)
    return 0
  }
  const run = command !== undefined && Object.hasOwn(commands, command) ? commands[command as keyof typeof commands] : undefined
  if (!run) {
    process.stderr.write(naturalUsage)
    return 2
  }
  try {
    return await run(args, { cwd: process.env.INIT_CWD ?? process.cwd() })
  }
  catch (error) {
    // Every failure here is a usage error or an unreadable, malformed or existing file: the tool reports, never gates.
    console.error(`lab:natural ${command}: ${errorMessageFrom(error) ?? 'failed'}`)
    return 2
  }
}

void main().then((code) => {
  process.exitCode = interrupt.signal.aborted ? 130 : code
}).finally(() => {
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
})
