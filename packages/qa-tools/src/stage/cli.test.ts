import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runStageCli } from './cli'
import { stageScenarioColumns } from './gates'

const context = { repoRoot: join(import.meta.dirname, '../../../..'), cwd: join(import.meta.dirname, '../../fixtures/stage'), selfPids: [] }

function captureOutput() {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  return {
    stdout: () => info.mock.calls.map(call => call.join(' ')).join('\n'),
    stderr: () => error.mock.calls.map(call => call.join(' ')).join('\n'),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('qa:stage gate', () => {
  it('prints one verdict per gate and exits 1 when the arm gate fails', async () => {
    const output = captureOutput()

    const code = await runStageCli(['gate', 'task-11-penetration.json', 'task-10-chisa.json'], context)

    expect(code).toBe(1)
    expect(output.stdout()).toMatch(/^stage-walk-skate: PASS$/m)
    expect(output.stdout()).toMatch(/^stage-arm-penetration: FAIL$/m)
    expect(output.stdout()).toMatch(/^stage-frame-budget: NO INPUT$/m)
  })

  it('exits 0 when every gate with input passes', async () => {
    captureOutput()

    expect(await runStageCli(['gate', 'task-11-chisa.json'], context)).toBe(0)
  })

  it('exits 2 for missing, unreadable or unrecognised evidence', async () => {
    const output = captureOutput()

    expect(await runStageCli(['gate'], context)).toBe(2)
    expect(await runStageCli(['gate', 'missing.json'], context)).toBe(2)
    expect(output.stderr()).toContain('missing.json: ENOENT')
  })
})

describe('qa:stage gate on scenario records', () => {
  it('judges a gesture-walk and an action-preempt record and exits 1 for the gait-on playing frame', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-stage-cli-'))
    try {
      const record = (scenario: string, clip: string, rows: unknown[][], stopAtMs = 2_000) => ({ kind: 'stage-scenario', version: 1, scenario, clip, seconds: 1, stopAtMs, measurement: { fps: 60, frames: 120, p95StageMs: 1 }, valid: true, series: { columns: [...stageScenarioColumns], rows } })
      const walk = join(dir, 'walk.json')
      const preempt = join(dir, 'preempt.json')
      writeFileSync(walk, JSON.stringify(record('gesture-walk', 'arms-wave', Array.from({ length: 120 }, (_, index) => [(index + 1) * 100, 'walking', true, 0.001, 0.001, 'arms-wave', 'upper', 'playing', false, 5]), 12_000)))
      writeFileSync(preempt, JSON.stringify(record('action-preempt', 'dance-long', [
        [0, 'idle', false, 0, 0, 'dance-long', 'full', 'playing', true, null],
        [100, 'walking', true, 0, 0, 'dance-long', 'full', 'playing', true, null],
        [200, 'walking', true, 0, 0, null, null, null, false, 5],
      ])))
      const output = captureOutput()

      expect(await runStageCli(['gate', walk, preempt], context)).toBe(1)
      expect(output.stdout()).toMatch(/^stage-gesture-walk: PASS$/m)
      expect(output.stdout()).toMatch(/^stage-action-preempt: FAIL$/m)
      expect(output.stdout()).toContain('locomotion.enabled true: #1 (t 0.1 s)')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('qa:stage measure arguments', () => {
  it.each([
    [['measure', '--mode', 'desktop', '--port', '9222'], '--out is required'],
    [['measure', '--mode', 'stage', '--port', '9222', '--out', 'x.json'], '--mode must be window or desktop, got stage'],
    [['measure', '--mode', 'desktop', '--out', 'x.json'], '--port <cdp port> is required without --pairs'],
    [['measure', '--pairs', '3', '--out', 'x.json'], '--pairs needs --profile'],
    [['measure', '--pairs', '3', '--mode', 'desktop', '--profile', 'p', '--out', 'x.json'], 'drop --mode and --port'],
    [['measure', '--mode', 'desktop', '--port', '9222', '--seconds', '0', '--out', 'x.json'], '--seconds must be a positive integer, got 0'],
    [['measure', '--mode', 'desktop', '--port', '9222', '--scenario', 'moonwalk', '--clip', 'a', '--out', 'x.json'], '--scenario must be gesture-walk or action-preempt, got moonwalk'],
    [['measure', '--mode', 'desktop', '--port', '9222', '--scenario', 'gesture-walk', '--out', 'x.json'], '--scenario needs --clip <clip name>'],
    [['measure', '--mode', 'desktop', '--port', '9222', '--clip', 'arms-wave', '--out', 'x.json'], '--clip needs --scenario'],
    [['measure', '--pairs', '3', '--profile', 'p', '--scenario', 'gesture-walk', '--clip', 'a', '--out', 'x.json'], '--scenario attaches to a running app; drop --pairs'],
    [['measure', '--bogus'], 'Unknown option'],
    [['launch'], 'unknown command launch'],
  ])('refuses %j before touching the app', async (argv, message) => {
    const output = captureOutput()

    expect(await runStageCli(argv, context)).toBe(2)
    expect(output.stderr()).toContain(message)
  })
})

describe('qa:stage capture pre-flight', () => {
  it('exits 2 before attaching and lists the holders while another worktree holds a CPU lease', async () => {
    const output = captureOutput()
    const busy = { id: 'verify', class: 'typecheck' as const, slots: 6, exclusive: false, cwd: '/wt/other', command: 'verify typecheck', pid: 4242, startedAt: 0, createdAt: 0, workload: [], age: 90_000 }

    const code = await runStageCli(['capture', '--port', '9', '--scenario', 'attach', '--seconds', '30', '--out', 'unused'], { ...context, readLeases: () => [busy] })

    expect(code).toBe(2)
    expect(output.stderr()).toContain('pid 4242')
    expect(output.stderr()).toContain('verify typecheck')
  })
})
