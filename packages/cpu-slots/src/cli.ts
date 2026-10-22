/* eslint-disable no-console -- the CLI prints to stdout */
import type { ChildProcess } from 'node:child_process'

import type { CpuClass } from './classes'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { constants } from 'node:os'

import { acquire } from './acquire'
import { classes } from './classes'
import { readStatusWithin, STATUS_WAIT_CAP_MS } from './status'
import { StoreBusyError } from './store'
import { resolveWin32Command, shimCommandLine } from './win32-command'

/**
 * Programs spawn directly, so arguments never meet a shell. Only a win32 .cmd/.bat shim (pnpm,
 * turbo) goes through cmd.exe, with arguments escaped by shimCommandLine.
 */
function launch(argv: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const [command, ...args] = argv
  if (process.platform === 'win32') {
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
    const { shim, doubleEscape } = resolveWin32Command(command, (pathKey && env[pathKey]) || '', env.PATHEXT, existsSync)
    if (shim) {
      return spawn(env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${shimCommandLine(shim, args, doubleEscape)}"`], {
        stdio: 'inherit',
        env,
        windowsVerbatimArguments: true,
      })
    }
  }
  return spawn(command, args, { stdio: 'inherit', env })
}

async function main(args: string[]): Promise<number> {
  const verb = args.shift()
  if (verb === 'status') {
    if (args.length > 1 || (args.length === 1 && args[0] !== '--json'))
      throw new Error('usage: status [--json]')
    let status
    try {
      status = await readStatusWithin()
    }
    catch (error) {
      if (!(error instanceof StoreBusyError))
        throw error
      console.error(`cpu-slots: status gave up after ${STATUS_WAIT_CAP_MS / 1_000}s; the store stayed busy (${error.message})`)
      return 3
    }
    if (args[0] === '--json') {
      console.log(JSON.stringify(status))
    }
    else {
      console.log(status.storePath)
      for (const lease of status.leases)
        console.log(`${lease.class} ${lease.slots} slots ${lease.cwd} ${lease.age}ms ${lease.command}`)
      for (const ticket of status.queue) {
        if ('malformed' in ticket)
          console.log(`queued malformed ${ticket.file} pid ${ticket.pid ?? '?'} touched ${ticket.touched}ms ago`)
        else
          console.log(`queued ${ticket.class} ${ticket.min}-${ticket.max} ${ticket.wait}ms ${ticket.command}`)
      }
      console.log(`held ${status.held}/${status.budget}`)
    }
    return 0
  }
  if (verb !== 'run')
    throw new Error('usage: run --class <class> [--min N] [--max N] -- <command...> | status [--json]')
  const separator = args.indexOf('--')
  if (separator < 0)
    throw new Error('missing command separator')
  const options = args.slice(0, separator)
  const command = args.slice(separator + 1)
  let cpuClass: CpuClass | undefined
  let min: number | undefined
  let max: number | undefined
  for (let i = 0; i < options.length; i += 2) {
    const name = options[i]
    const value = options[i + 1]
    if (name === '--class' && value && Object.hasOwn(classes, value)) {
      cpuClass = value as CpuClass
    }
    else if ((name === '--min' || name === '--max') && value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) {
      if (name === '--min')
        min = Number(value)
      else
        max = Number(value)
    }
    else {
      throw new Error(`bad option ${name}`)
    }
  }
  if (!cpuClass || !command.length)
    throw new Error('class and command are required')
  const lease = await acquire({ class: cpuClass, min, max, command: command.join(' '), cwd: process.cwd() })
  const substituted = command.flatMap(arg => lease.grant === null && arg.includes('{grant}') ? [] : [arg.replaceAll('{grant}', String(lease.grant))])
  if (!substituted.length) {
    lease.release()
    throw new Error('empty command')
  }
  return new Promise<number>((resolve, reject) => {
    const child = launch(substituted, { ...process.env, ...lease.env })
    // A win32 shell wrapper (cmd.exe) would otherwise die alone and orphan the real workload.
    const stop = (signal: NodeJS.Signals): void => {
      if (process.platform === 'win32' && child.pid)
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      else
        child.kill(signal)
    }
    const interrupt = (): void => stop('SIGINT')
    const terminate = (): void => stop('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    const cleanup = (): void => {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', terminate)
      lease.release()
    }
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('close', (code, signal) => {
      cleanup()
      resolve(code ?? (signal ? 128 + constants.signals[signal] : 1))
    })
    if (child.pid)
      lease.addWorkload(child.pid)
  })
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
}, (error: unknown) => {
  console.error(`cpu-slots: ${String(error)}`)
  process.exitCode = 2
})
