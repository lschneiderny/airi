import type { Buffer } from 'node:buffer'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import process from 'node:process'

import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { acquire } from '../src/acquire'
import { isAlive } from '../src/liveness'

const here = dirname(fileURLToPath(import.meta.url))
const cwd = resolve(here, '../../..')
const cli = join(here, '../src/cli.ts')
let root: string
let children: Running[]
let survivors: Set<number>

class Running {
  readonly child: ChildProcessWithoutNullStreams
  readonly exited: Promise<number | null>
  readonly events = new EventEmitter()
  output = ''
  stderr = ''
  code: number | null | undefined

  constructor(args: string[], env: NodeJS.ProcessEnv = {}) {
    this.child = spawn(process.execPath, ['--import', 'tsx', ...args], {
      cwd,
      env: {
        ...process.env,
        CI: '',
        AIRI_CPU_SLOTS: '',
        AIRI_CPU_LEASE: '',
        AIRI_CPU_GRANT: '',
        AIRI_CPU_CLASS: '',
        AIRI_CPU_SLOTS_DIR: root,
        AIRI_CPU_BUDGET: '8',
        ...env,
      },
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stdout.on('data', (data: Buffer) => {
      this.output += data.toString()
      this.events.emit('output')
    })
    this.child.stderr.on('data', (data: Buffer) => {
      this.stderr += data.toString()
      this.events.emit('output')
    })
    this.exited = new Promise((resolveExit, reject) => {
      this.child.once('error', reject)
      this.child.once('exit', (code) => {
        this.code = code
        this.events.emit('output')
        resolveExit(code)
      })
    })
    children.push(this)
  }

  async line(pattern: RegExp, stderr = false): Promise<RegExpMatchArray> {
    return new Promise((resolveLine, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let check = (): void => {}
      const finish = (error?: Error, match?: RegExpMatchArray): void => {
        clearTimeout(timer)
        this.events.removeListener('output', check)
        if (error)
          reject(error)
        else
          resolveLine(match!)
      }
      check = (): void => {
        const match = (stderr ? this.stderr : this.output).match(pattern)
        if (match)
          finish(undefined, match)
        else if (this.code !== undefined)
          finish(new Error(`Exited ${this.code} before ${pattern}\n${this.output}\n${this.stderr}`))
      }
      timer = setTimeout(() => finish(new Error(`Timed out waiting for ${pattern}\n${this.output}\n${this.stderr}`)), 30_000)
      this.events.on('output', check)
      check()
    })
  }

  async exit(): Promise<number | null> {
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.exited,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error(`Timed out waiting for exit\n${this.output}\n${this.stderr}`)), 30_000)
        }),
      ])
    }
    finally {
      clearTimeout(deadline)
    }
  }
}

function run(script: string, env: NodeJS.ProcessEnv = {}, options: string[] = ['--class', 'test']): Running {
  return new Running([cli, 'run', ...options, '--', process.execPath, '-e', script, cwd], env)
}

// Command lines are compared in one normal form: lower case, forward slashes.
const normalized = (path: string): string => path.toLowerCase().replaceAll('\\', '/')

function kill(pid: number, tree = true): void {
  if (!isAlive(pid))
    return
  if (process.platform === 'win32') {
    const identity = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8', timeout: 10_000 })
    expect(identity.status).toBe(0)
    expect(normalized(identity.stdout)).toContain(normalized(cwd))
    const result = spawnSync('taskkill', ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'], { encoding: 'utf8', timeout: 10_000 })
    expect(result.status, result.stderr).toBe(0)
  }
  else {
    process.kill(tree ? -pid : pid, 'SIGKILL')
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'airi-cpu-cli-'))
  children = []
  survivors = new Set()
})

afterEach(async () => {
  for (const child of children) {
    if (child.code === undefined && child.child.pid)
      kill(child.child.pid)
  }
  for (const pid of survivors)
    kill(pid)
  await Promise.all(children.map(child => child.exit()))
  rmSync(root, { recursive: true, force: true })
})

it('substitutes grant, exposes env, passes exit 3, and status JSON starts with store path', async () => {
  const child = run(`console.log(process.env.AIRI_CPU_GRANT);console.log(JSON.stringify(process.argv.slice(1)))`)
  expect(await child.exit()).toBe(0)
  expect(child.output).toContain('6\n')
  const substituted = new Running([cli, 'run', '--class', 'test', '--', process.execPath, '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', '--concurrency={grant}'])
  expect(await substituted.exit()).toBe(0)
  expect(JSON.parse(substituted.output.trim())).toEqual(['--concurrency=6'])
  const failed = run('process.exit(3)')
  expect(await failed.exit()).toBe(3)
  const status = new Running([cli, 'status', '--json'])
  expect(await status.exit()).toBe(0)
  const json = JSON.parse(status.output)
  expect(Object.keys(json)[0]).toBe('storePath')
  expect(json).toMatchObject({ storePath: root, leases: [], queue: [], held: 0, budget: 8 })
}, 30_000)

it('drops the entire grant argument when off and creates no store files', async () => {
  const child = new Running([cli, 'run', '--class', 'typecheck', '--', process.execPath, '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--concurrency={grant}'], { AIRI_CPU_SLOTS: 'off' })
  expect(await child.exit()).toBe(0)
  expect(JSON.parse(child.output.trim())).toEqual([])
  expect(existsSync(join(root, 'leases'))).toBe(false)
}, 30_000)

it.each([
  ['--class', 'bogus'],
  ['--class', 'test', '--min', '0'],
  ['--class', 'test', '--max', 'wat'],
  ['--class', 'test', '--min', '6', '--max', '2'],
])('rejects malformed options %j', async (...options) => {
  expect(await run('process.exit(0)', {}, options).exit()).toBe(2)
}, 30_000)

it('rejects a malformed budget', async () => {
  const child = run('process.exit(0)', { AIRI_CPU_BUDGET: 'abc' })
  expect(await child.exit()).toBe(2)
  expect(child.stderr).toContain('bad-budget')
}, 30_000)

it('runs unbrokered when the store cannot be created', async () => {
  const file = join(root, 'file')
  writeFileSync(file, '')
  const child = run(`console.log('FALLBACK-RUN')`, { AIRI_CPU_SLOTS_DIR: join(file, 'store') })
  expect(await child.exit()).toBe(0)
  expect(child.output).toContain('FALLBACK-RUN')
  expect(child.stderr).toContain('running unbrokered')
}, 30_000)

it('queued standalone CLI survives until the holder stdin closes', async () => {
  const env = { AIRI_CPU_BUDGET: '2' }
  const a = run(`process.stdout.write('A-RUN\\n');process.stdin.resume()`, env, ['--class', 'test', '--min', '2'])
  await a.line(/^A-RUN\r?$/m)
  const b = run(`console.log('B-RUN')`, env, ['--class', 'test', '--min', '2'])
  await b.line(/cpu-slots: waiting/, true)
  expect(b.code).toBeUndefined()
  expect(b.output).not.toContain('B-RUN')
  const granted = b.line(/^B-RUN\r?$/m)
  a.child.stdin.end()
  await granted
  expect([await a.exit(), a.stderr]).toEqual([0, a.stderr])
  expect(await b.exit()).toBe(0)
}, 30_000)

it('three children receive 6, 2, then 6 without exceeding budget 8', async () => {
  let held = 0
  const first = new Running([join(here, 'fixtures/holder.ts')])
  held += Number((await first.line(/^GRANTED (\d+) .*$/m))[1])
  expect(held).toBe(6)
  const second = new Running([join(here, 'fixtures/holder.ts')])
  held += Number((await second.line(/^GRANTED (\d+) .*$/m))[1])
  expect(held).toBe(8)
  const third = new Running([join(here, 'fixtures/holder.ts')])
  await third.line(/cpu-slots: waiting/, true)
  const released = first.line(/^RELEASED\r?$/m)
  first.child.stdin.write('release\n')
  await released
  held -= 6
  held += Number((await third.line(/^GRANTED (\d+) .*$/m))[1])
  expect(held).toBe(8)
  for (const child of [second, third]) {
    const done = child.line(/^RELEASED\r?$/m)
    child.child.stdin.write('release\n')
    await done
  }
  expect(await Promise.all([first.exit(), second.exit(), third.exit()])).toEqual([0, 0, 0])
}, 30_000)

it('inherits without tickets and rejects exclusive-under-shared with exit 2', async () => {
  const holder = new Running([join(here, 'fixtures/holder.ts')])
  await holder.line(/^GRANTED 6 .*$/m)
  const status = new Running([cli, 'status', '--json'])
  expect(await status.exit()).toBe(0)
  const parent = JSON.parse(status.output).leases[0]
  const env = { AIRI_CPU_LEASE: parent.id, AIRI_CPU_GRANT: '6' }
  const child = run(`console.log('INHERITED')`, env)
  expect(await child.exit()).toBe(0)
  const exclusive = run(`console.log('BAD')`, env, ['--class', 'exclusive'])
  expect(await exclusive.exit()).toBe(2)
  expect(exclusive.stderr).toContain('exclusive-under-shared')
  holder.child.stdin.write('release\n')
  expect(await holder.exit()).toBe(0)
}, 30_000)

// IS-4 allows 2.5 s from a workload's death to the next grant; the margin covers the process snapshot spawn.
const IS4_BOUND_MS = 2_500
const IS4_MARGIN_MS = 2_000

// Runs after the lease file lists this process (or its shell parent) as a workload; state-driven,
// bounded polling on a timer. Exits 99 if registration never appears.
const afterRegistered = (then: string): string => `const fs=require('fs');const f=process.env.AIRI_CPU_SLOTS_DIR+'/leases/'+process.env.AIRI_CPU_LEASE+'.json';const end=Date.now()+20000;const t=setInterval(()=>{try{if(JSON.parse(fs.readFileSync(f,'utf8')).workload.some(w=>w.pid===process.pid||w.pid===process.ppid)){clearInterval(t);${then}}}catch{}if(Date.now()>end)process.exit(99)},20)`
const registeredWorkload = afterRegistered(`process.stdout.write('W-RUN '+process.pid+'\\n');setInterval(()=>{},1000)`)

it('a15 prunes a lease after its whole tree is killed', async () => {
  const env = { AIRI_CPU_BUDGET: '6' }
  const a = run(registeredWorkload, env, ['--class', 'test', '--min', '6', '--max', '6'])
  survivors.add(Number((await a.line(/^W-RUN (\d+)\r?$/m))[1]))
  kill(a.child.pid!)
  await a.exit()
  const b = run(`console.log('B-RUN')`, env, ['--class', 'exclusive'])
  await b.line(/^B-RUN\r?$/m)
  expect(await b.exit()).toBe(0)
}, 30_000)

it('a20 keeps the lease while a workload that escaped its coordinator lives', async () => {
  const env = { AIRI_CPU_BUDGET: '6' }
  const coordinator = new Running([join(here, 'fixtures/escaper.ts')], env)
  const workload = Number((await coordinator.line(/^W-RUN (\d+)\r?$/m))[1])
  survivors.add(workload)
  kill(coordinator.child.pid!, false)
  await coordinator.exit()
  expect(isAlive(workload)).toBe(true)
  const status = new Running([cli, 'status', '--json'], env)
  expect(await status.exit()).toBe(0)
  const record = JSON.parse(status.output).leases[0]
  expect(existsSync(join(root, 'leases', `${record.id}.json`))).toBe(true)
  const b = run(`console.log('B-RUN')`, env, ['--class', 'exclusive'])
  await b.line(/cpu-slots: waiting/, true)
  expect(b.output).not.toContain('B-RUN')
  kill(workload, false)
  const killedAt = performance.now()
  await b.line(/^B-RUN\r?$/m)
  expect(performance.now() - killedAt).toBeLessThan(IS4_BOUND_MS + IS4_MARGIN_MS)
  expect(await b.exit()).toBe(0)
  survivors.delete(workload)
}, 30_000)

// Whether an attached workload dies with its coordinator depends on the OS (Windows job objects, POSIX
// reparenting). The lease contract does not: a grant after the kill implies the workload is gone.
it('a20c an attached CLI workload never outlives a grant that follows its coordinator kill', async () => {
  const env = { AIRI_CPU_BUDGET: '6' }
  const a = run(registeredWorkload, env, ['--class', 'test', '--min', '6', '--max', '6'])
  const workload = Number((await a.line(/^W-RUN (\d+)\r?$/m))[1])
  survivors.add(workload)
  kill(a.child.pid!, false)
  await a.exit()
  const b = run(`console.log('B-RUN')`, env, ['--class', 'exclusive'])
  const waiting = b.line(/cpu-slots: waiting/, true).then(() => true, () => false)
  const granted = b.line(/^B-RUN\r?$/m).then(() => true, () => false)
  if (await Promise.race([waiting.then(didWait => didWait && 'waiting'), granted.then(() => 'granted')]) === 'waiting') {
    expect(b.output).not.toContain('B-RUN')
    kill(workload, false)
  }
  expect(await granted).toBe(true)
  expect(isAlive(workload)).toBe(false)
  expect(await b.exit()).toBe(0)
  survivors.delete(workload)
}, 30_000)

it.each([false, true])('a21 graceful exit retains surviving workload; descendant=%s', async (descendant) => {
  if (descendant && process.platform !== 'win32')
    return
  const env = { AIRI_CPU_BUDGET: '6' }
  const coordinator = new Running([join(here, 'fixtures/coordinator.ts'), ...(descendant ? ['descendant'] : [])], env)
  const workload = Number((await coordinator.line(descendant ? /^D-RUN (\d+)\r?$/m : /^W-RUN (\d+)\r?$/m))[1])
  survivors.add(workload)
  await coordinator.line(/^COORD-EXIT\r?$/m)
  expect(await coordinator.exit()).toBe(0)
  expect(isAlive(workload)).toBe(true)
  const status = new Running([cli, 'status', '--json'], env)
  expect(await status.exit()).toBe(0)
  const record = JSON.parse(status.output).leases[0]
  expect(record).toBeDefined()
  expect(existsSync(join(root, 'leases', `${record.id}.json`))).toBe(true)
  const b = run(`console.log('B-RUN')`, env, ['--class', 'exclusive'])
  await b.line(/cpu-slots: waiting/, true)
  expect(b.output).not.toContain('B-RUN')
  kill(workload, !descendant)
  await b.line(/^B-RUN\r?$/m)
  expect(await b.exit()).toBe(0)
  survivors.delete(workload)
}, 30_000)

it('keeps the exit code and registers the workload of an inherited run while the broker lock is contended', async () => {
  const holder = new Running([join(here, 'fixtures/holder.ts')])
  const parentId = (await holder.line(/^GRANTED (\d+) (\S+) /m))[2]
  const hammer = new Running([join(here, 'fixtures/hammer.ts')])
  await hammer.line(/^HAMMER-READY\r?$/m)
  const exits: (number | null)[] = []
  for (let i = 0; i < 5; i++)
    exits.push(await run(afterRegistered('process.exit(5)'), { AIRI_CPU_LEASE: parentId, AIRI_CPU_GRANT: '6' }).exit())
  expect(exits).toEqual([5, 5, 5, 5, 5])
  kill(hammer.child.pid!)
  await hammer.exit()
  holder.child.stdin.write('release\n')
  expect(await holder.exit()).toBe(0)
}, 180_000)

// The busy-lock variant of the waiting line has no counts, so these counts prove the ticket exists.
const queued = /waiting for \d+ slot\(s\) of exclusive \(held \d+\/\d+, \d+ ahead\)/

it('a14 three processes and an in-process caller are granted strictly in ticket order', async () => {
  vi.stubEnv('AIRI_CPU_SLOTS_DIR', root)
  vi.stubEnv('AIRI_CPU_BUDGET', '8')
  for (const name of ['CI', 'AIRI_CPU_SLOTS', 'AIRI_CPU_LEASE', 'AIRI_CPU_GRANT'])
    vi.stubEnv(name, '')
  // A separate process holds the budget: a lease owned by this test process would stay held while the
  // process has children, which is exactly what releaseIfIdle must do.
  const blocker = new Running([join(here, 'fixtures/holder.ts'), 'exclusive'])
  await blocker.line(/^GRANTED \d+ .*$/m)
  const abort = new AbortController()
  try {
    const first = new Running([join(here, 'fixtures/holder.ts'), 'exclusive'])
    await first.line(queued, true)
    const second = new Running([join(here, 'fixtures/holder.ts'), 'exclusive'])
    await second.line(queued, true)
    const third = new Running([join(here, 'fixtures/holder.ts'), 'exclusive'])
    await third.line(queued, true)
    // Last in line: a lease owned by this process stays held while any child of it lives.
    const inProcess = acquire({ class: 'exclusive', cwd, command: 'in-process', signal: abort.signal })
    inProcess.catch(() => {})
    const freed = blocker.line(/^RELEASED\r?$/m)
    blocker.child.stdin.write('release\n')
    await freed

    const granted: number[] = []
    for (const proc of [first, second, third]) {
      granted.push(Number((await proc.line(/^GRANTED \d+ \S+ (\d+)\r?$/m))[1]))
      const released = proc.line(/^RELEASED\r?$/m)
      proc.child.stdin.write('release\n')
      await released
      await proc.exit()
    }
    const lease = await inProcess
    granted.push(lease.seq!)
    lease.release()
    expect(granted).toEqual([...granted].sort((a, b) => a - b))
    expect(new Set(granted).size).toBe(4)
  }
  finally {
    abort.abort()
    vi.unstubAllEnvs()
  }
}, 120_000)

it('passes quotes, ampersands, and percent signs to a program without a shell', async () => {
  const quoted = new Running([cli, 'run', '--class', 'test', '--', process.execPath, '-e', 'console.log("a & echo INJECTED")'])
  expect(await quoted.exit()).toBe(0)
  expect(quoted.output.trim().split(/\r?\n/)).toEqual(['a & echo INJECTED'])
  const percent = new Running([cli, 'run', '--class', 'test', '--', process.execPath, '-e', 'console.log(process.argv[1])', '%AIRI_TEST_EXPANSION%'], { AIRI_TEST_EXPANSION: 'expanded' })
  expect(await percent.exit()).toBe(0)
  expect(percent.output.trim()).toBe('%AIRI_TEST_EXPANSION%')
}, 60_000)

it.runIf(process.platform === 'win32')('escapes arguments for a .cmd shim so cmd.exe runs nothing extra', async () => {
  const directory = join(root, 'with space')
  mkdirSync(directory)
  const shim = join(directory, 'show.cmd')
  writeFileSync(shim, '@echo off\r\n"%AIRI_TEST_NODE%" -e "console.log(JSON.stringify(process.argv.slice(1)))" -- %*\r\n')
  const args = ['a & echo INJECTED', '%AIRI_TEST_EXPANSION%', 'x^y|z<q>(w)!v', '--concurrency={grant}']
  const child = new Running([cli, 'run', '--class', 'test', '--', shim, ...args], { AIRI_TEST_EXPANSION: 'expanded', AIRI_TEST_NODE: process.execPath })
  expect(await child.exit()).toBe(0)
  expect(child.output.trim().split(/\r?\n/)).toEqual([JSON.stringify([...args.slice(0, 3), '--concurrency=6'])])
}, 60_000)

// The repo's own pnpm-generated shims resolve their package through %~dp0, so the program name must
// reach cmd.exe unquoted.
function repoBin(): NodeJS.ProcessEnv {
  const key = Object.keys(process.env).find(name => name.toLowerCase() === 'path') ?? 'PATH'
  return { [key]: `${join(cwd, 'node_modules', '.bin')};${process.env[key]}` }
}

it.runIf(process.platform === 'win32')('runs the real turbo and pnpm shims', async () => {
  const turbo = new Running([cli, 'run', '--class', 'build', '--', 'turbo', '--version'], repoBin())
  expect(await turbo.exit()).toBe(0)
  expect(turbo.output).toMatch(/^\d+\.\d+\.\d+/m)
  const pnpm = new Running([cli, 'run', '--class', 'test', '--', 'pnpm', '--version'], repoBin())
  expect(await pnpm.exit()).toBe(0)
  expect(pnpm.output).toMatch(/^\d+\.\d+\.\d+/m)
}, 120_000)

it.runIf(process.platform === 'win32')('runs turbo with the grant substituted into --concurrency', async () => {
  const child = new Running([cli, 'run', '--class', 'typecheck', '--', 'turbo', 'run', 'typecheck', '--dry-run=json', '-F', '@proj-airi/cpu-slots', '--concurrency={grant}'], repoBin())
  expect(await child.exit()).toBe(0)
  expect(child.stderr).toContain('granted 6 (typecheck)')
  expect(JSON.parse(child.output).packages).toEqual(['@proj-airi/cpu-slots'])
}, 120_000)
