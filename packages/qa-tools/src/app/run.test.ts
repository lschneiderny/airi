import type { Lease } from '@proj-airi/cpu-slots'
import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import type { LaunchOptions } from '../session/app-session'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppSessionCore } from '../session/app-session'
import { parseAppArgs } from './args'
import { runApp } from './run'

vi.mock('../session/app-session', async importOriginal => ({
  ...await importOriginal<typeof import('../session/app-session')>(),
  refuseIfWorktreeBusy: vi.fn(async () => {}),
}))
vi.mock('../llm/script', () => ({ loadScript: vi.fn(async () => ({ source: 'test', entries: [] })) }))
vi.mock('../llm/server', () => ({
  ReplayServer: class {
    async listen() { return 'http://127.0.0.1:1/v1/' }
    async close() {}
  },
}))

const repoRoot = resolve(import.meta.dirname, '../../../..')
const lease: Lease = { id: 'test', grant: 4, exclusive: false, inherited: false, env: {}, addWorkload: vi.fn(), release: vi.fn() }

describe('runApp launch env', () => {
  let outDir: string
  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'qa-run-test-'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(outDir, { recursive: true, force: true })
  })

  /** Runs the app flow on a session whose launch fails at once, and returns the launch options `runApp` asked for. */
  async function requestedLaunch(extra: string[]): Promise<LaunchOptions> {
    const launches: LaunchOptions[] = []
    vi.spyOn(AppSessionCore, 'create').mockImplementation(context => new AppSessionCore<CdpClient>(context, {
      list: async () => [],
      kill: async pid => ({ pid, invocation: 'fake', exitCode: 0, output: '' }),
      sleep: async () => {},
      launch: async (options) => {
        launches.push(options)
        throw new Error('launch stopped by the test')
      },
      connect: async () => { throw new Error('not reached') },
      createErrorCollector: () => { throw new Error('not reached') },
      completeOnboarding: async () => {},
      closeBrowser: async () => {},
      groupMembers: () => [],
    }))
    const options = parseAppArgs(['run', '--model', 'a.zip', '--say', 'x', '--out', join(outDir, 'run'), ...extra], repoRoot)
    await runApp(options, repoRoot, new AbortController().signal, lease)
    expect(launches).toHaveLength(1)
    return launches[0]
  }

  it('hands --perf-dir to the real launch as recording on in an absolute directory', async () => {
    expect((await requestedLaunch(['--perf-dir', 'p'])).env).toMatchObject({ AIRI_PERF_RECORD: '1', AIRI_PERF_DIR: resolve(repoRoot, 'p') })
  })

  it('launches on the classic window by default', async () => {
    expect((await requestedLaunch([])).env).toMatchObject({ AIRI_STAGE_HOST: 'window' })
  })

  it('launches without a forced host for --stage-host desktop, so the setting saved in the profile decides', async () => {
    expect((await requestedLaunch(['--kind', 'mmd', '--stage-host', 'desktop'])).env).toMatchObject({ AIRI_STAGE_HOST: '' })
  })

  it('leaves recording to the launcher default without --perf-dir', async () => {
    const { env } = await requestedLaunch([])
    expect(env).not.toHaveProperty('AIRI_PERF_RECORD')
    expect(env).not.toHaveProperty('AIRI_PERF_DIR')
  })
})
