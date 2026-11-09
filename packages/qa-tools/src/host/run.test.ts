import type { HostSample } from './smoke'

import process from 'node:process'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applySmokeResult, runHostCli } from './run'
import { evaluateHostSmoke, hostSmokeExpectation, linuxDesktopFacts } from './smoke'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('host smoke report', () => {
  it('keeps the typed evaluator failures, such as backend-mismatch, in the serialized report', () => {
    const kwin = capabilitiesForHost('linux-wayland', linuxDesktopFacts({ backend: 'kwin', verified: [] }))
    const samples: HostSample[] = [0, 180_000].map(atMs => ({ atMs, host: kwin, desktopIdleSeconds: null, performanceMode: 'idle', foreground: null }))
    const expectation = hostSmokeExpectation(desktop => capabilitiesForHost('linux-wayland', desktop ?? undefined), { backend: 'sway', verified: ['geometry'] })
    const report = { exitCode: 2 as number, failures: [] as unknown[] }
    applySmokeResult(report, evaluateHostSmoke({ ...expectation, samples }))
    const persisted = JSON.parse(JSON.stringify(report)) as { exitCode: number, failures: Array<{ code: string }> }
    expect(persisted.exitCode).toBe(1)
    expect(persisted.failures.map(failure => failure.code)).toEqual(expect.arrayContaining(['backend-mismatch', 'verification-missing']))
  })

  it('prints a refused run with a typed failure and exit 2, before taking any lease', async () => {
    const written: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })
    await expect(runHostCli(['smoke', '--expect-idle', 'sometimes'], process.cwd())).resolves.toBe(2)
    const printed = JSON.parse(written.join('')) as { exitCode: number, failures: Array<{ code: string, message: string }> }
    expect(printed.exitCode).toBe(2)
    expect(printed.failures).toEqual([{ code: 'refused', message: '--expect-idle must be verified or unverified' }])
  })
})
