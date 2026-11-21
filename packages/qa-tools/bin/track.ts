import type { TrackHost } from '../src/track/run'
import type { TimerHost } from '../src/track/timer'

import process from 'node:process'

import { execFile, execFileSync, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { sampleHost } from '../src/host-quiet/wait'
import { formatSkipped } from '../src/perf/format'
import { defaultGit } from '../src/track/accepted-costs'
import { parseTrackArgs, TRACK_HELP, TrackUsageError } from '../src/track/args'
import { appendTrackEvent, foldFindings, readTrackEvents, trackHistoryPath } from '../src/track/findings'
import { runTick } from '../src/track/run'
import { installTimer, uninstallTimer } from '../src/track/timer'

const print = (text: string) => process.stdout.write(`${text}\n`)
const note = (text: string | null) => text !== null && process.stderr.write(text.split('\n').map(line => `perf:track: ${line}\n`).join(''))

const toolRoot = resolve(import.meta.dirname, '../../..')
const execFileAsync = promisify(execFile)

function trackHost(signal: AbortSignal): TrackHost {
  return {
    toolRoot,
    stateDir: dirname(trackHistoryPath({ platform: process.platform, env: process.env, homedir: homedir() })),
    env: process.env,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pid: process.pid,
    signal,
    git: (cwd, args) => defaultGit(cwd)(args),
    gh: async args => (await execFileAsync('gh', [...args], { cwd: toolRoot, encoding: 'utf8' })).stdout,
    spawn: (command, args, options) => new Promise((resolveCode, reject) => {
      // Child output goes to stderr, so the tick's stdout holds only its own subject and finding lines.
      const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: ['ignore', process.stderr, 'inherit'] })
      child.once('error', reject)
      child.once('close', (code, signalName) => resolveCode(code ?? (signalName === 'SIGINT' || signalName === 'SIGTERM' ? 130 : 1)))
    }),
    sampleHost: () => sampleHost(),
    // The tick runs on the host, outside qa:display, so notify-send reaches the user's session bus.
    notify: async (title, body) => {
      await execFileAsync('notify-send', ['--app-name=AIRI', title, body])
    },
    now: () => Date.now(),
    pidAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      }
      catch (error) {
        // EPERM: the pid exists under another user.
        return error instanceof Error && 'code' in error && error.code === 'EPERM'
      }
    },
    print,
    log: line => note(line),
  }
}

function timerHost(): TimerHost {
  const run = (command: string) => (args: readonly string[]) => execFileSync(command, [...args], { cwd: toolRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return {
    git: run('git'),
    systemctl: run('systemctl'),
    configHome: process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    pathEnv: process.env.PATH ?? '',
    print,
  }
}

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
    case 'tick': {
      const controller = new AbortController()
      const stop = () => controller.abort()
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
      try {
        return await runTick(trackHost(controller.signal), command)
      }
      finally {
        process.off('SIGINT', stop)
        process.off('SIGTERM', stop)
      }
    }
    case 'install-timer':
      installTimer(timerHost(), { ref: command.ref })
      return 0
    case 'uninstall-timer':
      uninstallTimer(timerHost())
      return 0
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
