import type { AcquireOptions, Lease } from '@proj-airi/cpu-slots'

import process from 'node:process'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquire, CpuSlotsError } from '@proj-airi/cpu-slots'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runT3Cli, T3_LEASE_TIMEOUT_EXIT, T3_LEASE_WAIT_MS } from './cli'

import * as rendered from './run-t3'

vi.mock('@proj-airi/cpu-slots', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/cpu-slots')>(),
  acquire: vi.fn(),
}))

const argv = ['--rig', 'forbooth', '--scenario', 'builtin:t3-smoke', '--lease', 'exclusive']
let rig: string
let written: string

beforeEach(() => {
  // resolveRig needs only a directory holding a *.model3.json; the run never reaches the launch.
  rig = mkdtempSync(join(tmpdir(), 'qa-t3-cli-'))
  writeFileSync(join(rig, 'rig.model3.json'), '{}')
  vi.stubEnv('AIRI_QA_RIG_FORBOOTH', rig)
  written = ''
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    written += String(chunk)
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.mocked(acquire).mockReset()
  rmSync(rig, { recursive: true, force: true })
})

describe('runT3Cli exclusive lease', () => {
  it.each([
    [[], 'live'],
    [['--lease', 'live'], 'live'],
    [['--lease', 'exclusive'], 'exclusive'],
  ])('requests the selected lease for %j', async (flags, expected) => {
    const stopped = new Error('stop before launch')
    vi.mocked(acquire).mockRejectedValue(stopped)

    await expect(runT3Cli([...argv.slice(0, 4), ...flags], rig)).rejects.toBe(stopped)

    expect(vi.mocked(acquire).mock.lastCall?.[0].class).toBe(expected)
  })

  it('keeps the caller lease until teardown finishes after repeated interruptions', async () => {
    const lease: Lease = { id: 'live', grant: 4, exclusive: false, inherited: false, env: {}, addWorkload: vi.fn(), release: vi.fn() }
    vi.mocked(acquire).mockResolvedValue(lease)
    let reached: () => void = () => {}
    const ready = new Promise<void>((resolve) => {
      reached = resolve
    })
    let finishTeardown: (result: rendered.RunT3Result) => void = () => {}
    const teardown = new Promise<rendered.RunT3Result>((resolve) => {
      finishTeardown = resolve
    })
    let signal: AbortSignal | undefined
    vi.spyOn(rendered, 'runT3').mockImplementation(async (options) => {
      signal = options.signal
      reached()
      return teardown
    })
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const listeners = process.listenerCount('SIGINT')
    const running = runT3Cli(argv.slice(0, 4), rig)
    await ready

    process.emit('SIGINT')
    process.emit('SIGINT')
    expect(signal?.aborted).toBe(true)
    expect(written).toContain('again (2); teardown is still running')
    expect(lease.release).not.toHaveBeenCalled()
    finishTeardown({ exitCode: 130, summary: 'interrupted after teardown' })

    expect(await running).toBe(130)
    expect(lease.release).toHaveBeenCalledOnce()
    expect(process.listenerCount('SIGINT')).toBe(listeners)
  })

  it('exits 2 with a clear message when it inherits a shared lease', async () => {
    vi.stubEnv('AIRI_CPU_LEASE', 'parent-lease')
    vi.mocked(acquire).mockRejectedValue(new CpuSlotsError('exclusive-under-shared'))
    expect(await runT3Cli(argv, rig)).toBe(2)
    expect(written).toContain('T3 needs an exclusive CPU lease, but it runs under the shared lease parent-lease it inherited')
  })

  it('bounds the wait for the lease at 30 min and exits with its own code', async () => {
    const timeout = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    let called!: () => void
    const invoked = new Promise<void>((resolve) => {
      called = resolve
    })
    vi.mocked(acquire).mockImplementation(({ signal }: AcquireOptions) => new Promise<Lease>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      called()
    }))
    const running = runT3Cli(argv, rig)
    await invoked
    expect(timeoutSpy).toHaveBeenCalledWith(T3_LEASE_WAIT_MS)
    expect(T3_LEASE_WAIT_MS).toBe(30 * 60_000)
    timeout.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    expect(await running).toBe(T3_LEASE_TIMEOUT_EXIT)
    expect([0, 1, 2, 130]).not.toContain(T3_LEASE_TIMEOUT_EXIT)
    expect(written).toContain('no exclusive CPU lease within 30 min')
  })
})
