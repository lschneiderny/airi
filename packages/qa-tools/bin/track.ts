import process from 'node:process'

import { homedir } from 'node:os'

import { errorMessageFrom } from '@moeru/std'

import { formatSkipped } from '../src/perf/format'
import { parseTrackArgs, TRACK_HELP, TrackUsageError } from '../src/track/args'
import { appendTrackEvent, foldFindings, readTrackEvents, trackHistoryPath } from '../src/track/findings'

const print = (text: string) => process.stdout.write(`${text}\n`)
const note = (text: string | null) => text !== null && process.stderr.write(text.split('\n').map(line => `perf:track: ${line}\n`).join(''))

async function main(): Promise<number> {
  const command = parseTrackArgs(process.argv.slice(2), process.env)
  switch (command.kind) {
    case 'help':
      print(TRACK_HELP)
      return 0
    case 'close': {
      const path = trackHistoryPath({ platform: process.platform, env: process.env, homedir: homedir() })
      const log = await readTrackEvents(path)
      note(formatSkipped([log.counts]))
      const open = foldFindings(log.events).open.map(finding => finding.id)
      if (!open.includes(command.id)) {
        note(`"${command.id}" is not an open finding in ${path}`)
        note(open.length > 0 ? `open findings:\n${open.join('\n')}` : 'no open findings')
        return 2
      }
      appendTrackEvent(path, { v: 1, t: Date.now(), event: 'finding-close', id: command.id, resolution: command.resolution, at: command.at, note: command.note, by: 'manual' })
      print(`closed ${command.id} as ${command.resolution}`)
      return 0
    }
    case 'tick':
    case 'install-timer':
    case 'uninstall-timer':
      note(`${command.kind} is not implemented in this commit`)
      return 1
    default: {
      const unhandled: never = command
      return unhandled
    }
  }
}

main().then((code) => {
  process.exitCode = code
}, (error) => {
  if (error instanceof TrackUsageError) {
    process.stderr.write(`perf:track: ${error.message}\n`)
    process.exitCode = 2
    return
  }
  process.stderr.write(`perf:track: ${errorMessageFrom(error) ?? 'failed'}\n`)
  process.exitCode = 1
})
