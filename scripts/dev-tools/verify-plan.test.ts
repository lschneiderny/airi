import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquire } from '@proj-airi/cpu-slots'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { lintAllFixable, parseVerifyArgs, planStepLease, planTestRuns, planVerify, selectBrowserTestProjects, testPrerequisiteTurboArgs, verifySteps } from './verify-plan'

const packages = ['packages/stage-ui', 'apps/stage-tamagotchi']
const file = (path: string, deleted = false) => ({ path, deleted })

describe('testPrerequisiteTurboArgs', () => {
  it('builds only the workspace packages that tests import, with quiet output', () => {
    expect(testPrerequisiteTurboArgs).toEqual(['run', 'build', '-F=./packages/*', '--output-logs=errors-only'])
  })
})

describe('planVerify', () => {
  it('typechecks affected packages when only package files changed', () => {
    const plan = planVerify([file('packages/stage-ui/src/a.ts'), file('docs/readme.md')], packages)
    expect(plan.typecheck).toEqual({ kind: 'affected' })
    expect(plan.lintFiles).toEqual(['packages/stage-ui/src/a.ts', 'docs/readme.md'])
    expect(plan.testFiles).toEqual(['packages/stage-ui/src/a.ts'])
    expect(plan.testPackagePaths).toEqual(['packages/stage-ui'])
  })

  it('lists each package with a changed code file once', () => {
    const plan = planVerify([file('packages/stage-ui/src/a.ts'), file('packages/stage-ui/src/b.vue'), file('apps/stage-tamagotchi/src/c.ts'), file('apps/stage-tamagotchi/README.md')], packages)
    expect(plan.testPackagePaths).toEqual(['packages/stage-ui', 'apps/stage-tamagotchi'])
  })

  it('typechecks every package when a root config file changed', () => {
    expect(planVerify([file('tsconfig.json')], packages).typecheck).toEqual({ kind: 'all', reason: 'tsconfig.json changed' })
    expect(planVerify([file('pnpm-lock.yaml')], packages).typecheck.kind).toBe('all')
  })

  it('plans the directory scope when the change is confined to a root dependency', () => {
    const withSlots = [...packages, 'packages/cpu-slots']
    expect(planVerify([file('packages/cpu-slots/src/store.ts')], withSlots, ['packages/cpu-slots']).typecheck)
      .toEqual({ kind: 'all', reason: 'packages/cpu-slots/src/store.ts is in a root dependency' })
  })

  it('keeps the affected scope for a package the root does not depend on', () => {
    expect(planVerify([file('packages/stage-ui/src/a.ts')], [...packages, 'packages/cpu-slots'], ['packages/cpu-slots']).typecheck)
      .toEqual({ kind: 'affected' })
  })

  it('treats a nested package.json as a package change, not a root change', () => {
    expect(planVerify([file('packages/stage-ui/package.json')], packages).typecheck).toEqual({ kind: 'affected' })
  })

  it('skips typecheck and browser projects for root-only code', () => {
    const plan = planVerify([file('scripts/dev-tools/verify.ts')], packages)
    expect(plan.typecheck).toEqual({ kind: 'none' })
    expect(plan.testFiles).toEqual(['scripts/dev-tools/verify.ts'])
    expect(plan.testPackagePaths).toEqual([])
  })

  it('keeps deleted files out of lint and test while still selecting typecheck', () => {
    const plan = planVerify([file('packages/stage-ui/src/gone.ts', true)], packages)
    expect(plan.typecheck).toEqual({ kind: 'affected' })
    expect(plan.lintFiles).toEqual([])
    expect(plan.testFiles).toEqual([])
  })

  it('skips typecheck for a documentation-only change, even in a root dependency', () => {
    const plan = planVerify([file('packages/stage-ui/README.md'), file('packages/cpu-slots/docs/notes.mdx')], [...packages, 'packages/cpu-slots'], ['packages/cpu-slots'])
    expect(plan.typecheck).toEqual({ kind: 'none' })
    expect(plan.typecheckPackagePaths).toEqual([])
    expect(plan.lintFiles).toEqual(['packages/stage-ui/README.md', 'packages/cpu-slots/docs/notes.mdx'])
  })

  it('runs the policy doc guard when a context doc changes', () => {
    const plan = planVerify([file('docs/ai/context/glossary.md'), file('docs/ai/adr/2026-01-01-example.md')], packages)
    expect(plan.testFiles).toEqual(['scripts/dev-tools/policy-docs.test.ts'])
    expect(plan.typecheck.kind).toBe('none')
  })

  it('runs tests related to changed JSON and YAML data, but not to manifests', () => {
    const plan = planVerify([
      file('packages/stage-ui/src/fixtures/bands.json'),
      file('packages/stage-ui/locales/en.yaml'),
      file('packages/stage-ui/package.json'),
      file('apps/stage-tamagotchi/tsconfig.node.json'),
    ], packages)
    expect(plan.testFiles).toEqual(['packages/stage-ui/src/fixtures/bands.json', 'packages/stage-ui/locales/en.yaml'])
    expect(plan.testPackagePaths).toEqual(['packages/stage-ui'])
  })

  it('does not lint binary assets', () => {
    expect(planVerify([file('apps/stage-tamagotchi/resources/icon.png')], packages).lintFiles).toEqual([])
  })

  it('does not match a package that only shares a name prefix', () => {
    expect(planVerify([file('packages/stage-ui-three/src/a.ts')], packages).typecheck).toEqual({ kind: 'none' })
  })
})

describe('selectBrowserTestProjects', () => {
  const projects = [
    { name: 'stage-ui-mmd:browser', packagePath: 'packages/stage-ui-mmd' },
    { name: 'stage-ui:browser', packagePath: 'packages/stage-ui' },
    { name: 'stage-tamagotchi:browser', packagePath: 'apps/stage-tamagotchi' },
  ]

  it('keeps the projects of affected packages once, in config order', () => {
    expect(selectBrowserTestProjects(['apps/stage-tamagotchi', 'packages/stage-ui', 'packages/stage-ui', 'packages/qa-tools'], projects))
      .toEqual(['stage-ui:browser', 'stage-tamagotchi:browser'])
  })

  it.each([
    { paths: [] },
    { paths: ['packages/core-agent'] },
    { paths: ['packages/stage-ui-mmd-extra', 'packages/stage'] },
  ])('starts no browser for unaffected packages: $paths', ({ paths }) => {
    expect(selectBrowserTestProjects(paths, projects)).toEqual([])
  })
})

describe('planTestRuns', () => {
  it('runs the root config alone when no browser project is affected', () => {
    expect(planTestRuns([])).toEqual([{ config: 'vitest.config.ts', projects: [] }])
  })

  it('gives every browser project its own Vitest process, so no process holds two Vite roots', () => {
    const runs = planTestRuns(['stage-ui:browser', 'stage-pages:browser', 'stage-tamagotchi:browser'])
    expect(runs).toEqual([
      { config: 'vitest.config.ts', projects: [] },
      { config: 'vitest.browser.config.ts', projects: ['stage-ui:browser'] },
      { config: 'vitest.browser.config.ts', projects: ['stage-pages:browser'] },
      { config: 'vitest.browser.config.ts', projects: ['stage-tamagotchi:browser'] },
    ])
  })
})

describe('parseVerifyArgs', () => {
  it('defaults to every step against main', () => {
    expect(parseVerifyArgs([])).toEqual({ ok: true, args: { base: 'main', steps: ['lint', 'typecheck', 'test'], dryRun: false, gate: false } })
  })

  it('keeps step order canonical whatever order --only lists', () => {
    expect(parseVerifyArgs(['--only', 'test,lint', '--base', 'origin/main', '--gate'])).toEqual({ ok: true, args: { base: 'origin/main', steps: ['lint', 'test'], dryRun: false, gate: true } })
  })

  it('rejects unknown steps, missing values, and stray arguments', () => {
    expect(parseVerifyArgs(['--only', 'build']).ok).toBe(false)
    expect(parseVerifyArgs(['--base']).ok).toBe(false)
    expect(parseVerifyArgs(['--base', '--gate']).ok).toBe(false)
    expect(parseVerifyArgs(['--no-cache']).ok).toBe(false)
    expect(parseVerifyArgs(['extra']).ok).toBe(false)
  })
})

describe('lintAllFixable', () => {
  const summary = (problems: number, errors: number, warnings: number) => `\u001B[31m✖ ${problems} problems (${errors} errors, ${warnings} warnings)\u001B[39m\n`
  const fixable = (errors: number, warnings: number) => `  ${errors} errors and ${warnings} warnings potentially fixable with the \`--fix\` option.\n`

  it('is true only when every problem of every batch is fixable', () => {
    expect(lintAllFixable(summary(3, 2, 1) + fixable(2, 1) + summary(2, 2, 0) + fixable(2, 0))).toBe(true)
    expect(lintAllFixable(summary(3, 2, 1) + fixable(2, 1) + summary(2, 2, 0) + fixable(1, 0))).toBe(false)
    expect(lintAllFixable(summary(1, 1, 0))).toBe(false)
  })

  it('gives no hint without an ESLint summary', () => {
    expect(lintAllFixable('Found 0 warnings and 2 errors.\n')).toBe(false)
  })
})

describe('planStepLease', () => {
  it('maps each step to its CPU class', () => {
    expect(verifySteps.map(step => planStepLease(step, { kind: 'affected' }, 3))).toEqual([
      { class: 'lint' },
      { class: 'typecheck', max: 3 },
      { class: 'test' },
    ])
  })

  it.each([
    { count: 0, max: 2 },
    { count: 1, max: 2 },
    { count: 2, max: 2 },
    { count: 5, max: 5 },
    { count: 20, max: 20 },
  ])('sizes an affected typecheck of $count packages to max $max', ({ count, max }) => {
    expect(planStepLease('typecheck', { kind: 'affected' }, count)).toEqual({ class: 'typecheck', max })
  })

  it('keeps the class default for an all-package typecheck', () => {
    expect(planStepLease('typecheck', { kind: 'all', reason: 'root config changed' }, 1)).toEqual({ class: 'typecheck' })
  })
})

describe('per-step slot acquisition', () => {
  let store: string

  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), 'verify-slots-'))
    vi.stubEnv('AIRI_CPU_SLOTS_DIR', store)
    vi.stubEnv('AIRI_CPU_SLOTS_HISTORY_DIR', join(store, 'history'))
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
    const request = (step: 'typecheck' | 'lint' | 'test') => ({ ...planStepLease(step, { kind: 'affected' }, 1), cwd: process.cwd(), command: `verify ${step}`, signal: AbortSignal.timeout(10_000) })
    const first = await acquire(request('typecheck'))
    expect(first.grant).toBe(2)
    first.release()
    const second = await acquire(request('lint'))
    expect(second.grant).toBe(1)
    second.release()
    const third = await acquire(request('test'))
    expect(third.grant).toBeGreaterThan(0)
    third.release()
  }, 30_000)
})
