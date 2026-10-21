import type { Buffer } from 'node:buffer'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import process from 'node:process'

import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, expect, it } from 'vitest'

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
    const timer = setTimeout(() => {}, 30_000)
    try {
      return await Promise.race([
        this.exited,
        new Promise<never>((_, reject) => {
          clearTimeout(timer)
          const deadline = setTimeout(() => reject(new Error(`Timed out waiting for exit\n${this.output}\n${this.stderr}`)), 30_000)
          this.exited.finally(() => clearTimeout(deadline))
        }),
      ])
    }
    finally {
      clearTimeout(timer)
    }
  }
}

function run(script: string, env: NodeJS.ProcessEnv = {}, options: string[] = ['--class', 'test']): Running {
  return new Running([cli, 'run', ...options, '--', process.execPath, '-e', script, 'cpu-budget-w1'], env)
}

function kill(pid: number, tree = true): void {
  if (!isAlive(pid))
    return
  if (process.platform === 'win32') {
    const identity = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8', timeout: 10_000 })
    expect(identity.status).toBe(0)
    expect(identity.stdout.toLowerCase()).toContain('cpu-budget-w1')
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
  expect(Object.keys(json)[0]).toBe('path')
  expect(json).toMatchObject({ path: root, leases: [], queue: [], held: 0, budget: 8 })
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
  held += Number((await first.line(/^GRANTED (\d+)\r?$/m))[1])
  expect(held).toBe(6)
  const second = new Running([join(here, 'fixtures/holder.ts')])
  held += Number((await second.line(/^GRANTED (\d+)\r?$/m))[1])
  expect(held).toBe(8)
  const third = new Running([join(here, 'fixtures/holder.ts')])
  await third.line(/cpu-slots: waiting/, true)
  const released = first.line(/^RELEASED\r?$/m)
  first.child.stdin.write('release\n')
  await released
  held -= 6
  held += Number((await third.line(/^GRANTED (\d+)\r?$/m))[1])
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
  await holder.line(/^GRANTED 6\r?$/m)
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

it.each(['tree', 'coordinator'])('a15/a20 prunes after %s death only when workload is gone', async (mode) => {
  const env = { AIRI_CPU_BUDGET: '6' }
  // The coordinator registers its workload right after spawning it, so the workload
  // announces itself only once the lease file lists it (no sleeps, state-driven).
  const registered = `const fs=require('fs');const f=process.env.AIRI_CPU_SLOTS_DIR+'/leases/'+process.env.AIRI_CPU_LEASE+'.json';for(;;){try{if(JSON.parse(fs.readFileSync(f,'utf8')).workload.length)break}catch{}}process.stdout.write('W-RUN '+process.pid+'\\n');setInterval(()=>{},1000)`
  const a = run(registered, env, ['--class', 'test', '--min', '6', '--max', '6'])
  const workload = Number((await a.line(/^W-RUN (\d+)\r?$/m))[1])
  survivors.add(workload)
  kill(a.child.pid!, mode === 'tree')
  await a.exit()
  if (mode === 'coordinator')
    expect(isAlive(workload)).toBe(true)
  const b = run(`console.log('B-RUN')`, env, ['--class', 'exclusive'])
  if (mode === 'coordinator') {
    await b.line(/cpu-slots: waiting/, true)
    expect(b.output).not.toContain('B-RUN')
    kill(workload, process.platform === 'win32')
  }
  await b.line(/^B-RUN\r?$/m)
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
