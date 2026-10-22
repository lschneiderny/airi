import type { ChildProcess } from 'node:child_process'

import type { Plugin, ViteUserConfig } from 'vitest/config'

import process from 'node:process'

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root: string
const originalArgv = process.argv

/** Fresh module graph and process state per test, as in a fresh vitest process. */
async function load() {
  vi.resetModules()
  Reflect.deleteProperty(globalThis, Symbol.for('@proj-airi/cpu-slots'))
  const liveness = await import('../src/liveness')
  const processes = await import('../src/processes')
  vi.spyOn(liveness, 'isSameProcess').mockReturnValue(true)
  vi.spyOn(processes, 'snapshotProcesses').mockReturnValue({ platform: process.platform, processes: [] })
  return {
    ...(await import('../src/acquire')),
    ...(await import('../src/status')),
    ...(await import('../src/vitest')),
  }
}

/** Makes the next acquire in this process look inherited from `lease`, as a child process would see it. */
function inheritFrom(lease: { env: Record<string, string | undefined> }) {
  for (const key of ['AIRI_CPU_LEASE', 'AIRI_CPU_GRANT', 'AIRI_CPU_CLASS'] as const)
    vi.stubEnv(key, lease.env[key] ?? '')
}

/** Runs vitest's configureVitest hook of every plugin the wrapper added, with the given resolved watch flag. */
function configureVitest(config: ViteUserConfig, watch: boolean) {
  for (const plugin of config.plugins as Plugin[])
    (plugin.configureVitest as (context: unknown) => void)({ vitest: { config: { watch } } })
}

beforeEach(() => {
  process.argv = ['node', '/x/node_modules/vitest/vitest.mjs', 'run']
  root = mkdtempSync(join(tmpdir(), 'airi-cpu-vitest-'))
  vi.stubEnv('AIRI_CPU_SLOTS_DIR', root)
  vi.stubEnv('AIRI_CPU_BUDGET', '12')
  vi.stubEnv('AIRI_CPU_SLOTS', '')
  vi.stubEnv('CI', '')
  vi.stubEnv('AIRI_CPU_LEASE', '')
  vi.stubEnv('AIRI_CPU_GRANT', '')
  vi.stubEnv('AIRI_CPU_CLASS', '')
})

afterEach(() => {
  process.argv = originalArgv
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('withCpuSlots', () => {
  it('takes no lease when the command line asks for watch mode, but still caps workers', async () => {
    vi.stubEnv('AIRI_CPU_BUDGET', '2')
    for (const flag of ['--watch', 'watch']) {
      const { withCpuSlots } = await load()
      process.argv = ['node', '/x/node_modules/vitest/vitest.mjs', flag]
      const first = await withCpuSlots({ test: {} })()
      expect(first.test?.maxWorkers).toBe(2)
      const project = await withCpuSlots({ test: { name: 'p', maxWorkers: 4 } })()
      expect(project.test?.maxWorkers).toBe(2)
      const serial = await withCpuSlots({ test: { name: 's', maxWorkers: 1, fileParallelism: false } })()
      expect(serial.test?.maxWorkers).toBe(1)
      expect(serial.test?.fileParallelism).toBe(false)
    }
    expect(readdirSync(root)).toEqual([])
  })

  it('leaves the config alone in watch mode when slots are off', async () => {
    vi.stubEnv('AIRI_CPU_SLOTS', 'off')
    const { withCpuSlots } = await load()
    process.argv = ['node', '/x/node_modules/vitest/vitest.mjs', '--watch']
    const config: ViteUserConfig = { test: { maxWorkers: 9 } }
    expect(await withCpuSlots(config)()).toBe(config)
  })

  it('leases a bare invocation and one without --run, since only vitest knows whether it will watch', async () => {
    for (const args of [[], ['--no-watch'], ['related', 'a.ts']]) {
      const { withCpuSlots } = await load()
      process.argv = ['node', '/x/node_modules/vitest/vitest.mjs', ...args]
      const resolved = await withCpuSlots({ test: {} })()
      expect(resolved.test?.maxWorkers).toBe(6)
      configureVitest(resolved, true)
    }
  })

  it('keeps the lease of a single run', async () => {
    const { readStatus, withCpuSlots } = await load()
    configureVitest(await withCpuSlots({ test: {} })(), false)
    expect(readStatus().leases).toHaveLength(1)
  })

  it('hands the lease back once vitest resolves to watch mode, keeping workers capped', async () => {
    const { readStatus, withCpuSlots } = await load()
    const resolved = await withCpuSlots({ test: {} })()
    expect(readStatus().leases).toHaveLength(1)
    configureVitest(resolved, true)
    expect(readStatus().leases).toHaveLength(0)
    expect(resolved.test?.maxWorkers).toBe(6)
  })

  it('returns the config unchanged when slots are disabled', async () => {
    vi.stubEnv('AIRI_CPU_SLOTS', 'off')
    const { withCpuSlots } = await load()
    const config: ViteUserConfig = { test: { maxWorkers: 9 } }
    expect(await withCpuSlots(config)()).toBe(config)
  })

  it('sets root maxWorkers from a fresh lease by detected class', async () => {
    const plain = await load()
    expect((await plain.withCpuSlots({ test: {} })()).test?.maxWorkers).toBe(6)
    const browser = await load()
    const config = await browser.withCpuSlots({ test: { browser: { enabled: true } } })()
    expect(config.test?.maxWorkers).toBe(4)
  })

  it('detects browser mode from an inline project', async () => {
    const { withCpuSlots } = await load()
    const config = await withCpuSlots({
      test: { projects: [{ test: { name: 'b', browser: { enabled: true } } }] },
    })()
    expect(config.test?.maxWorkers).toBe(4)
  })

  it('keeps an existing root maxWorkers when it is below the grant', async () => {
    const { withCpuSlots } = await load()
    expect((await withCpuSlots({ test: { maxWorkers: 1 } })()).test?.maxWorkers).toBe(1)
  })

  it('sizes an inherited test grant of 6 to 4 for a browser config', async () => {
    const { acquire, withCpuSlots } = await load()
    const parent = await acquire({ class: 'test', cwd: '/w', command: 'parent' })
    expect(parent.grant).toBe(6)
    inheritFrom(parent)
    const config = await withCpuSlots({ test: { browser: { enabled: true } } })()
    expect(config.test?.maxWorkers).toBe(4)
    parent.release()
  })

  it('passes an inherited gate grant of 10 through to a non-browser config', async () => {
    const { acquire, withCpuSlots } = await load()
    const parent = await acquire({ class: 'gate', cwd: '/w', command: 'parent' })
    expect(parent.grant).toBe(10)
    inheritFrom(parent)
    const config = await withCpuSlots({ test: {} })()
    expect(config.test?.maxWorkers).toBe(10)
    parent.release()
  })

  it('reuses the first grant for later project configs and only clamps them downward', async () => {
    vi.stubEnv('AIRI_CPU_BUDGET', '2')
    const { readStatus, withCpuSlots } = await load()
    const rootConfig = await withCpuSlots({ test: {} })()
    expect(rootConfig.test?.maxWorkers).toBe(2)

    const bare = await withCpuSlots({ test: { name: 'bare' } })()
    expect(bare.test).not.toHaveProperty('maxWorkers')

    const qaNode = await withCpuSlots({
      test: { name: 'qa-node', pool: 'forks', maxWorkers: 4, sequence: { groupOrder: 1 } },
    })()
    expect(qaNode.test?.maxWorkers).toBe(2)
    expect(qaNode.test?.sequence?.groupOrder).toBe(1)

    const serial = await withCpuSlots({ test: { name: 'serial', maxWorkers: 1, fileParallelism: false } })()
    expect(serial.test?.maxWorkers).toBe(1)
    expect(serial.test?.fileParallelism).toBe(false)
    expect(readStatus().leases).toHaveLength(1)
  })

  it('clamps an existing maxWorkers of 4 to an inherited grant of 2 and keeps groupOrder', async () => {
    vi.stubEnv('AIRI_CPU_BUDGET', '2')
    const { acquire, withCpuSlots } = await load()
    const parent = await acquire({ class: 'test', cwd: '/w', command: 'parent' })
    inheritFrom(parent)
    const config = await withCpuSlots({
      test: { pool: 'forks', maxWorkers: 4, sequence: { groupOrder: 1 } },
    })()
    expect(config.test?.maxWorkers).toBe(2)
    expect(config.test?.sequence?.groupOrder).toBe(1)
    parent.release()
  })

  it('clamps maxWorkers declared on inline projects', async () => {
    vi.stubEnv('AIRI_CPU_BUDGET', '2')
    const { withCpuSlots } = await load()
    const config = await withCpuSlots({
      test: { projects: [{ test: { name: 'p', maxWorkers: 4 } }, { test: { name: 'q' } }] },
    })()
    const projects = config.test?.projects as ViteUserConfig[]
    expect(projects[0].test?.maxWorkers).toBe(2)
    expect(projects[1].test).not.toHaveProperty('maxWorkers')
  })

  it('sizes an inline browser project at the grant, since the browser pool ignores the root value', async () => {
    vi.stubEnv('AIRI_CPU_BUDGET', '2')
    const { withCpuSlots } = await load()
    const config = await withCpuSlots({
      test: {
        projects: [
          { test: { name: 'unset', browser: { enabled: true } } },
          { test: { name: 'lower', maxWorkers: 1, browser: { enabled: true } } },
          { test: { name: 'higher', maxWorkers: 8, browser: { enabled: true } } },
          { test: { name: 'serial', fileParallelism: false, browser: { enabled: true } } },
          { test: { name: 'node' } },
        ],
      },
    })()
    const projects = config.test?.projects as ViteUserConfig[]
    expect(projects[0].test?.maxWorkers).toBe(2)
    expect(projects[1].test?.maxWorkers).toBe(1)
    expect(projects[2].test?.maxWorkers).toBe(2)
    expect(projects[3].test).not.toHaveProperty('maxWorkers')
    expect(projects[4].test).not.toHaveProperty('maxWorkers')
  })

  it('sizes a later project config with browser mode at the grant of the first call', async () => {
    vi.stubEnv('AIRI_CPU_BUDGET', '2')
    const { withCpuSlots } = await load()
    expect((await withCpuSlots({ test: {} })()).test?.maxWorkers).toBe(2)
    const browser = await withCpuSlots({ test: { name: 'browser', browser: { enabled: true } } })()
    expect(browser.test?.maxWorkers).toBe(2)
    const node = await withCpuSlots({ test: { name: 'node' } })()
    expect(node.test).not.toHaveProperty('maxWorkers')
  })
})

describe('assertFreshBuild', () => {
  let src: string
  const files = ['a.ts', 'b.ts']
  const stampFor = async (hashSources: (dir: string, files: string[]) => string) => JSON.stringify({ hash: hashSources(src, files), files })

  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), 'airi-cpu-src-'))
    writeFileSync(join(src, 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(src, 'b.ts'), 'export const b = 2\n')
  })

  afterEach(() => rmSync(src, { recursive: true, force: true }))

  it('passes while the bundled sources are unchanged, whatever their line endings', async () => {
    const { assertFreshBuild, hashSources } = await import('../src/stale-build')
    const stamp = await stampFor(hashSources)
    expect(() => assertFreshBuild(src, stamp)).not.toThrow()
    writeFileSync(join(src, 'a.ts'), 'export const a = 1\r\n')
    expect(() => assertFreshBuild(src, stamp)).not.toThrow()
  })

  it('fails with the stale-build error once a bundled source changed or vanished', async () => {
    const { assertFreshBuild, hashSources, StaleBuildError } = await import('../src/stale-build')
    const stamp = await stampFor(hashSources)
    writeFileSync(join(src, 'b.ts'), 'export const b = 3\n')
    expect(() => assertFreshBuild(src, stamp)).toThrow(StaleBuildError)
    writeFileSync(join(src, 'b.ts'), 'export const b = 2\n')
    expect(() => assertFreshBuild(src, stamp)).not.toThrow()
    rmSync(join(src, 'b.ts'))
    expect(() => assertFreshBuild(src, stamp)).toThrow(StaleBuildError)
  })

  it('is skipped when running from source or when src is absent', async () => {
    const { assertFreshBuild, hashSources } = await import('../src/stale-build')
    const stamp = await stampFor(hashSources)
    expect(() => assertFreshBuild(src, '__CPU_SLOTS_BUILD_STAMP__')).not.toThrow()
    expect(() => assertFreshBuild(join(src, 'missing'), stamp)).not.toThrow()
  })

  it('checks the shipped dist against src in under 50 ms', async () => {
    const { assertFreshBuild } = await import('../src/stale-build')
    const dist = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'vitest.mjs'), 'utf8')
    const stamp = JSON.parse(`"${/"(\{\\"hash\\".*?\})"/.exec(dist)![1]}"`) as string
    const realSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
    assertFreshBuild(realSrc, stamp)
    const timings = Array.from({ length: 5 }, () => {
      const start = performance.now()
      assertFreshBuild(realSrc, stamp)
      return performance.now() - start
    })
    expect(Math.min(...timings)).toBeLessThan(50)
  })
})

/**
 * Real vitest processes: Vite bundles every config file on its own and Node loads the package export
 * natively, which no single-module-graph unit test reproduces.
 */
describe('withCpuSlots in a real vitest process', () => {
  const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'vitest-wrapper')
  const vitestBin = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs')
  const TIMEOUT_MS = 90_000

  function start(args: string[], env: Record<string, string>) {
    const probeOut = join(root, 'probe.jsonl')
    const child = spawn(process.execPath, [vitestBin, ...args], {
      cwd: fixtures,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, AIRI_CPU_SLOTS_DIR: root, AIRI_CPU_BUDGET: '12', CI: '', AIRI_CPU_SLOTS: '', AIRI_CPU_LEASE: '', AIRI_CPU_GRANT: '', AIRI_CPU_CLASS: '', PROBE_OUT: probeOut, ...env },
    })
    let stderr = ''
    child.stderr.on('data', chunk => stderr += String(chunk))
    return {
      child,
      stderr: () => stderr,
      probe: (): { leases: number, held: number, start?: number, end?: number }[] => existsSync(probeOut) ? readFileSync(probeOut, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [],
    }
  }

  function exited(child: ChildProcess): Promise<number | null> {
    return new Promise(resolve => child.once('exit', resolve))
  }

  function killTree(child: ChildProcess) {
    if (child.pid === undefined || child.exitCode !== null)
      return
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'])
    else
      child.kill('SIGKILL')
  }

  /** Waits for probe lines, which a watch-mode process writes before it idles forever. */
  async function probes(run: ReturnType<typeof start>, count = 1) {
    const deadline = Date.now() + TIMEOUT_MS - 10_000
    while (run.probe().length < count && run.child.exitCode === null && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 100))
    return run.probe()
  }

  it('holds one lease and finishes when a wrapped root and a wrapped project are bundled separately, at budget 2', async () => {
    const run = start(['run', '--config', 'bundled.config.ts'], { AIRI_CPU_BUDGET: '2' })
    const code = await Promise.race([exited(run.child), new Promise<'hung'>(resolve => setTimeout(resolve, TIMEOUT_MS - 10_000, 'hung'))])
    killTree(run.child)
    expect(code, run.stderr()).toBe(0)
    expect(run.probe()).toEqual([{ leases: 1, held: 2 }])
  }, TIMEOUT_MS)

  it('prints one grant for that run at budget 12', async () => {
    const run = start(['run', '--config', 'bundled.config.ts'], {})
    expect(await exited(run.child), run.stderr()).toBe(0)
    expect(run.stderr().match(/granted/g)).toHaveLength(1)
    expect(run.probe()).toEqual([{ leases: 1, held: 6 }])
  }, TIMEOUT_MS)

  it('loads the package export from a config and holds a lease for `run` and a bare invocation without a TTY', async () => {
    for (const args of [['run'], [], ['--no-watch']]) {
      rmSync(join(root, 'probe.jsonl'), { force: true })
      const run = start([...args, '--config', 'package.config.ts'], {})
      expect(await exited(run.child), run.stderr()).toBe(0)
      expect(run.probe(), args.join(' ')).toEqual([{ leases: 1, held: 6 }])
    }
  }, TIMEOUT_MS)

  it('caps an explicit --watch session at the grant of a free store, without a lease', async () => {
    const run = start(['--watch', '--config', 'overlap.config.ts'], { AIRI_CPU_BUDGET: '2' })
    try {
      const lines = await probes(run, 4)
      expect(lines, run.stderr()).toHaveLength(4)
      expect(lines.map(line => line.leases)).toEqual([0, 0, 0, 0])
      const overlap = Math.max(...lines.map(line => lines.filter(other => other.start! <= line.start! && line.start! < other.end!).length))
      expect(overlap).toBeLessThanOrEqual(2)
    }
    finally {
      killTree(run.child)
      await exited(run.child)
    }
  }, TIMEOUT_MS)

  it('fails the config load when dist/vitest.mjs is stale and passes again once it matches', async () => {
    const pkg = join(fixtures, '..', '..', '..')
    const copy = join(root, 'stale')
    mkdirSync(join(copy, 'dist'), { recursive: true })
    mkdirSync(join(copy, 'src'))
    copyFileSync(join(pkg, 'dist', 'vitest.mjs'), join(copy, 'dist', 'vitest.mjs'))
    for (const file of readdirSync(join(pkg, 'src')))
      copyFileSync(join(pkg, 'src', file), join(copy, 'src', file))
    writeFileSync(join(copy, 'vitest.config.mjs'), 'import { withCpuSlots } from \'./dist/vitest.mjs\'\nexport default withCpuSlots({ test: { globals: true, include: [\'x.test.mjs\'] } })\n')
    writeFileSync(join(copy, 'x.test.mjs'), 'it(\'x\', () => {})\n')
    const runCopy = () => start(['run', '--root', copy], {})

    const fresh = runCopy()
    expect(await exited(fresh.child), fresh.stderr()).toBe(0)

    const source = join(copy, 'src', 'vitest.ts')
    const original = readFileSync(source, 'utf8')
    writeFileSync(source, `${original}\n// edited after the build\n`)
    const stale = runCopy()
    expect(await exited(stale.child)).not.toBe(0)
    expect(stale.stderr()).toContain('dist/vitest.mjs is stale (src changed); run pnpm -F @proj-airi/cpu-slots build')

    writeFileSync(source, original)
    const matching = runCopy()
    expect(await exited(matching.child), matching.stderr()).toBe(0)
  }, TIMEOUT_MS)

  it('holds no lease once a watch session has started', async () => {
    for (const args of [['--watch', '--config', 'package.config.ts'], ['related', 'probe.fixture.ts', '--config', 'watch.config.ts']]) {
      rmSync(join(root, 'probe.jsonl'), { force: true })
      const run = start(args, {})
      try {
        expect(await probes(run), `${args.join(' ')}\n${run.stderr()}`).toEqual([{ leases: 0, held: 0 }])
      }
      finally {
        killTree(run.child)
        await exited(run.child)
      }
    }
  }, TIMEOUT_MS)
})
