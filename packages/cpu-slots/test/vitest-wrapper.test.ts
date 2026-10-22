import type { ViteUserConfig } from 'vitest/config'

import process from 'node:process'

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root: string
const originalArgv = process.argv

/** Fresh module graph per test: the wrapper keeps process-wide state and acquire keeps its held lease. */
async function load() {
  vi.resetModules()
  const liveness = await import('../src/liveness')
  const processes = await import('../src/processes')
  vi.spyOn(liveness, 'isSameProcess').mockReturnValue(true)
  vi.spyOn(processes, 'snapshotProcesses').mockReturnValue({ platform: process.platform, processes: [] })
  return {
    ...(await import('../src/acquire')),
    ...(await import('../src/vitest')),
  }
}

/** Makes the next acquire in this process look inherited from `lease`, as a child process would see it. */
function inheritFrom(lease: { env: Record<string, string | undefined> }) {
  for (const key of ['AIRI_CPU_LEASE', 'AIRI_CPU_GRANT', 'AIRI_CPU_CLASS'] as const)
    vi.stubEnv(key, lease.env[key] ?? '')
}

async function resolveConfig(wrapped: () => Promise<ViteUserConfig>): Promise<ViteUserConfig> {
  return wrapped()
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
  it('makes no lease in watch mode', async () => {
    const { withCpuSlots } = await load()
    const config: ViteUserConfig = { test: { watch: true } }
    expect(await resolveConfig(withCpuSlots(config))).toBe(config)
    expect(readdirSync(root)).toEqual([])
  })

  it('treats a bare vitest invocation as watch mode and `run` as a single run', async () => {
    const { withCpuSlots } = await load()
    const config: ViteUserConfig = { test: {} }
    try {
      process.argv = ['node', '/x/node_modules/vitest/vitest.mjs']
      expect(await resolveConfig(withCpuSlots(config))).toBe(config)
      process.argv = ['node', '/x/node_modules/vitest/vitest.mjs', 'run']
      expect((await resolveConfig(withCpuSlots(config))).test?.maxWorkers).toBe(6)
    }
    finally {
      process.argv = originalArgv
    }
  })

  it('returns the config unchanged when slots are disabled', async () => {
    vi.stubEnv('AIRI_CPU_SLOTS', 'off')
    const { withCpuSlots } = await load()
    const config: ViteUserConfig = { test: { watch: false, maxWorkers: 9 } }
    expect(await resolveConfig(withCpuSlots(config))).toBe(config)
  })

  it('sets root maxWorkers from a fresh lease by detected class', async () => {
    const plain = await load()
    expect((await resolveConfig(plain.withCpuSlots({ test: { watch: false } }))).test?.maxWorkers).toBe(6)
    const browser = await load()
    const config = await resolveConfig(browser.withCpuSlots({ test: { watch: false, browser: { enabled: true } } }))
    expect(config.test?.maxWorkers).toBe(4)
  })

  it('detects browser mode from an inline project', async () => {
    const { withCpuSlots } = await load()
    const config = await resolveConfig(withCpuSlots({
      test: { watch: false, projects: [{ test: { name: 'b', browser: { enabled: true } } }] },
    }))
    expect(config.test?.maxWorkers).toBe(4)
  })

  it('keeps an existing root maxWorkers when it is below the grant', async () => {
    const { withCpuSlots } = await load()
    expect((await resolveConfig(withCpuSlots({ test: { watch: false, maxWorkers: 1 } }))).test?.maxWorkers).toBe(1)
  })

  it('sizes an inherited test grant of 6 to 4 for a browser config', async () => {
    const { acquire, withCpuSlots } = await load()
    const parent = await acquire({ class: 'test', cwd: '/w', command: 'parent' })
    expect(parent.grant).toBe(6)
    inheritFrom(parent)
    const config = await resolveConfig(withCpuSlots({ test: { watch: false, browser: { enabled: true } } }))
    expect(config.test?.maxWorkers).toBe(4)
    parent.release()
  })

  it('passes an inherited gate grant of 10 through to a non-browser config', async () => {
    const { acquire, withCpuSlots } = await load()
    const parent = await acquire({ class: 'gate', cwd: '/w', command: 'parent' })
    expect(parent.grant).toBe(10)
    inheritFrom(parent)
    const config = await resolveConfig(withCpuSlots({ test: { watch: false } }))
    expect(config.test?.maxWorkers).toBe(10)
    parent.release()
  })

  it('reuses the first grant for later project configs and only clamps them downward', async () => {
    vi.stubEnv('AIRI_CPU_BUDGET', '2')
    const { withCpuSlots } = await load()
    const root = await resolveConfig(withCpuSlots({ test: { watch: false } }))
    expect(root.test?.maxWorkers).toBe(2)

    const bare = await resolveConfig(withCpuSlots({ test: { name: 'bare' } }))
    expect(bare.test).not.toHaveProperty('maxWorkers')

    const qaNode = await resolveConfig(withCpuSlots({
      test: { name: 'qa-node', pool: 'forks', maxWorkers: 4, sequence: { groupOrder: 1 } },
    }))
    expect(qaNode.test?.maxWorkers).toBe(2)
    expect(qaNode.test?.sequence?.groupOrder).toBe(1)

    const serial = await resolveConfig(withCpuSlots({ test: { name: 'serial', maxWorkers: 1, fileParallelism: false } }))
    expect(serial.test?.maxWorkers).toBe(1)
    expect(serial.test?.fileParallelism).toBe(false)
  })

  it('clamps an existing maxWorkers of 4 to an inherited grant of 2 and keeps groupOrder', async () => {
    vi.stubEnv('AIRI_CPU_BUDGET', '2')
    const { acquire, withCpuSlots } = await load()
    const parent = await acquire({ class: 'test', cwd: '/w', command: 'parent' })
    inheritFrom(parent)
    const config = await resolveConfig(withCpuSlots({
      test: { watch: false, pool: 'forks', maxWorkers: 4, sequence: { groupOrder: 1 } },
    }))
    expect(config.test?.maxWorkers).toBe(2)
    expect(config.test?.sequence?.groupOrder).toBe(1)
    parent.release()
  })

  it('clamps maxWorkers declared on inline projects', async () => {
    vi.stubEnv('AIRI_CPU_BUDGET', '2')
    const { withCpuSlots } = await load()
    const config = await resolveConfig(withCpuSlots({
      test: { watch: false, projects: [{ test: { name: 'p', maxWorkers: 4 } }, { test: { name: 'q' } }] },
    }))
    const projects = config.test?.projects as ViteUserConfig[]
    expect(projects[0].test?.maxWorkers).toBe(2)
    expect(projects[1].test).not.toHaveProperty('maxWorkers')
  })
})
