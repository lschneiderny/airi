import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquire } from '@proj-airi/cpu-slots'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { verifyCacheKey } from './verify-cache'
import { parseVerifyArgs, planVerify, stripWorkerFlags } from './verify-plan'

const packages = ['packages/stage-ui', 'apps/stage-tamagotchi']
const file = (path: string, deleted = false) => ({ path, deleted })

describe('planVerify', () => {
  it('typechecks affected packages when only package files changed', () => {
    const plan = planVerify([file('packages/stage-ui/src/a.ts'), file('docs/readme.md')], packages)
    expect(plan.typecheck).toEqual({ kind: 'affected' })
    expect(plan.lintFiles).toEqual(['packages/stage-ui/src/a.ts', 'docs/readme.md'])
    expect(plan.testFiles).toEqual(['packages/stage-ui/src/a.ts'])
    expect(plan.extraTestConfigs).toBe(true)
  })

  it('typechecks every package when a root config file changed', () => {
    expect(planVerify([file('tsconfig.json')], packages).typecheck).toEqual({ kind: 'all', reason: 'tsconfig.json changed' })
    expect(planVerify([file('pnpm-lock.yaml')], packages).typecheck.kind).toBe('all')
  })

  it('plans the directory scope when the change is confined to a root dependency', () => {
    const withSlots = [...packages, 'packages/cpu-slots']
    expect(planVerify([file('packages/cpu-slots/README.md')], withSlots, ['packages/cpu-slots']).typecheck)
      .toEqual({ kind: 'all', reason: 'packages/cpu-slots/README.md is in a root dependency' })
  })

  it('keeps the affected scope for a package the root does not depend on', () => {
    expect(planVerify([file('packages/stage-ui/src/a.ts')], [...packages, 'packages/cpu-slots'], ['packages/cpu-slots']).typecheck)
      .toEqual({ kind: 'affected' })
  })

  it('treats a nested package.json as a package change, not a root change', () => {
    expect(planVerify([file('packages/stage-ui/package.json')], packages).typecheck).toEqual({ kind: 'affected' })
  })

  it('skips typecheck and extra test configs for root-only code', () => {
    const plan = planVerify([file('scripts/dev-tools/verify.ts')], packages)
    expect(plan.typecheck).toEqual({ kind: 'none' })
    expect(plan.testFiles).toEqual(['scripts/dev-tools/verify.ts'])
    expect(plan.extraTestConfigs).toBe(false)
  })

  it('keeps deleted files out of lint and test while still selecting typecheck', () => {
    const plan = planVerify([file('packages/stage-ui/src/gone.ts', true)], packages)
    expect(plan.typecheck).toEqual({ kind: 'affected' })
    expect(plan.lintFiles).toEqual([])
    expect(plan.testFiles).toEqual([])
  })

  it('does not lint binary assets', () => {
    expect(planVerify([file('apps/stage-tamagotchi/resources/icon.png')], packages).lintFiles).toEqual([])
  })

  it('does not match a package that only shares a name prefix', () => {
    expect(planVerify([file('packages/stage-ui-three/src/a.ts')], packages).typecheck).toEqual({ kind: 'none' })
  })
})

describe('parseVerifyArgs', () => {
  it('defaults to every step against main', () => {
    expect(parseVerifyArgs([])).toEqual({ ok: true, args: { base: 'main', steps: ['typecheck', 'lint', 'test'], force: false, dryRun: false } })
  })

  it('keeps step order canonical whatever order --only lists', () => {
    expect(parseVerifyArgs(['--only', 'test,lint', '--base', 'origin/main', '--force'])).toEqual({ ok: true, args: { base: 'origin/main', steps: ['lint', 'test'], force: true, dryRun: false } })
  })

  it('rejects unknown steps, missing values, and stray arguments', () => {
    expect(parseVerifyArgs(['--only', 'build']).ok).toBe(false)
    expect(parseVerifyArgs(['--base']).ok).toBe(false)
    expect(parseVerifyArgs(['--base', '--force']).ok).toBe(false)
    expect(parseVerifyArgs(['extra']).ok).toBe(false)
  })
})

describe('stripWorkerFlags', () => {
  it('removes both worker flags in = and separate-value spelling and nothing else', () => {
    expect(stripWorkerFlags(['turbo', 'run', 'typecheck', '--concurrency=4', '--maxWorkers', '2', '--output-logs=errors-only', '--maxWorkers=3', '--concurrency', '5', 'a.ts']))
      .toEqual(['turbo', 'run', 'typecheck', '--output-logs=errors-only', 'a.ts'])
  })

  it('leaves similarly named flags alone', () => {
    expect(stripWorkerFlags(['--concurrencyX=1', '--max-workers=2', '--config', 'c.ts'])).toEqual(['--concurrencyX=1', '--max-workers=2', '--config', 'c.ts'])
  })

  it('gives the same cache key for commands that differ only in those flags', () => {
    const key = (command: string[]) => verifyCacheKey({ tree: 't', step: 'typecheck', command: stripWorkerFlags(command), node: 'v', platform: 'win32' })
    expect(key(['turbo', 'run', '--concurrency=2'])).toBe(key(['turbo', 'run', '--concurrency=8', '--maxWorkers=1']))
    expect(key(['turbo', 'run'])).not.toBe(key(['turbo', 'build']))
  })
})

describe('per-command slot acquisition', () => {
  let store: string

  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), 'verify-slots-'))
    vi.stubEnv('AIRI_CPU_SLOTS_DIR', store)
    vi.stubEnv('AIRI_CPU_BUDGET', '12')
    vi.stubEnv('AIRI_CPU_SLOTS', '')
    vi.stubEnv('CI', '')
    vi.stubEnv('AIRI_CPU_LEASE', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(store, { recursive: true, force: true })
  })

  // NOTICE:
  // The test runs three real acquisitions against the broker, which snapshots processes on each acquire.
  // acquire() builds its Store without snapshotProcesses or processStartedAt (packages/cpu-slots/src/acquire.ts), so no fake can be injected.
  // Removal condition: drop the explicit timeout once acquire() accepts injected store options.
  it('grants the next step immediately after the previous step releases', async () => {
    const request = (cpuClass: 'typecheck' | 'lint' | 'test') => ({ class: cpuClass, cwd: process.cwd(), command: `verify ${cpuClass}`, signal: AbortSignal.timeout(10_000) })
    const first = await acquire(request('typecheck'))
    expect(first.grant).toBeGreaterThan(0)
    first.release()
    const second = await acquire(request('lint'))
    expect(second.grant).toBe(1)
    second.release()
    const third = await acquire(request('test'))
    expect(third.grant).toBeGreaterThan(0)
    third.release()
  }, 30_000)
})
