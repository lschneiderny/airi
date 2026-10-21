/* eslint-disable no-console -- the CLI prints to stdout */
import type { CpuClass } from './classes'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { constants } from 'node:os'

import { acquire, storeRoot } from './acquire'
import { parseBudget } from './budget'
import { classes } from './classes'
import { Store, StoreBusyError } from './store'

async function main(args: string[]): Promise<number> {
  const verb = args.shift()
  if (verb === 'status') {
    if (args.length > 1 || (args.length === 1 && args[0] !== '--json'))
      throw new Error('usage: status [--json]')
    const root = storeRoot()
    const budget = parseBudget()
    const store = new Store({ root, budget })
    let state
    for (;;) {
      try {
        state = store.snapshot()
        break
      }
      catch (error) {
        if (!(error instanceof StoreBusyError))
          throw error
        await new Promise<void>(resolve => setTimeout(resolve, 500))
      }
    }
    const now = Date.now()
    const status = {
      path: root,
      leases: state.leases.map(lease => ({ ...lease, age: now - lease.createdAt })),
      queue: state.tickets.map(ticket => ({ ...ticket, wait: now - ticket.createdAt })),
      held: state.leases.reduce((sum, lease) => sum + lease.slots, 0),
      budget,
    }
    if (args[0] === '--json') {
      console.log(JSON.stringify(status))
    }
    else {
      console.log(root)
      for (const lease of status.leases)
        console.log(`${lease.class} ${lease.slots} slots ${lease.cwd} ${lease.age}ms ${lease.command}`)
      for (const ticket of status.queue)
        console.log(`queued ${ticket.class} ${ticket.min}-${ticket.max} ${ticket.wait}ms ${ticket.command}`)
      console.log(`held ${status.held}/${budget}`)
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
    // cmd.exe requires argument quoting; Node's shell mode otherwise joins arguments verbatim.
    const shell = process.platform === 'win32' && !/^node(?:\.exe)?$|\.exe$/i.test(substituted[0])
    const argv = shell
      ? substituted.map(arg => `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`)
      : substituted
    // cmd.exe loses piped output when detached, so only directly spawned executables detach.
    const detached = !shell && !process.stdin.isTTY && !process.stdout.isTTY && !process.stderr.isTTY
    const child = spawn(argv[0], argv.slice(1), {
      // A detached Windows child loses inherited stdio handles, so its output is relayed.
      stdio: detached ? 'pipe' : 'inherit',
      env: { ...process.env, ...lease.env },
      shell,
      // NOTICE:
      // libuv kills a non-detached child with its parent's Windows job object.
      // Root cause: only UV_PROCESS_DETACHED escapes it, and A20 needs workloads to outlive the coordinator.
      // Source: node child_process 'detached' option.
      // Removal condition: none; interactive terminals stay attached for Ctrl+C and TTY output.
      detached,
    })
    if (detached) {
      child.stdout!.pipe(process.stdout)
      child.stderr!.pipe(process.stderr)
      process.stdin.pipe(child.stdin!)
      // The coordinator may die first; the orphaned workload then loses its pipe, not the lease.
      child.stdin!.on('error', () => {})
    }
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
