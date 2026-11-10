import type { Lease } from '@proj-airi/cpu-slots'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runT3Gate } from './t3-gate'

import * as processes from '../../env/processes'
import * as runs from '../../evidence/run'
import * as rendered from '../../t3/run-t3'

// OS identity is an external boundary. This case must exercise XWayland on every test host.
vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<NodeJS.Process & { default: NodeJS.Process }>()
  return {
    ...actual,
    default: new Proxy(actual.default, { get: (target, key) => key === 'platform' ? 'linux' : Reflect.get(target, key) }),
    platform: 'linux',
  }
})

afterEach(() => vi.restoreAllMocks())

describe('t3 host gate wiring', () => {
  it('passes dev:xwayland and the profile to the capture runner without converting a refused capture to success', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-t3-host-'))
    const rig = join(root, 'rig')
    mkdirSync(rig)
    writeFileSync(join(rig, 'test.model3.json'), '{}')
    const createRun = runs.createRun
    const readGitState = () => ({ gitSha: 'host-profile-test', dirty: false })
    vi.spyOn(runs, 'readGitStateFromRepo').mockImplementation(readGitState)
    vi.spyOn(runs, 'createRun').mockImplementation(options => createRun({ ...options, readGitState }))
    vi.spyOn(processes, 'listLiveProcesses').mockResolvedValue([])
    const capture = vi.spyOn(rendered, 'runT3').mockResolvedValue({ exitCode: 2, summary: 'capture launch refused by test boundary' })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const lease: Lease = { id: 'gate', grant: 12, exclusive: true, inherited: false, env: {}, addWorkload: vi.fn(), release: vi.fn() }
    try {
      const code = await runT3Gate({ target: 'liveliness', host: 'linux-xwayland', t1Report: null, rescore: null, lease }, root, {
        WAYLAND_DISPLAY: 'wayland-0',
        AIRI_QA_RIG_FORBOOTH: rig,
      }, () => 'frozen-gates')

      expect(capture).toHaveBeenCalledOnce()
      expect(capture.mock.calls[0][0]).toMatchObject({
        script: 'dev:xwayland',
        scenario: { settings: { host: 'linux-xwayland' } },
        idleAfterSeconds: 180,
        lease,
      })
      expect(code).toBe(1)
      expect(lease.release).not.toHaveBeenCalled()
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
