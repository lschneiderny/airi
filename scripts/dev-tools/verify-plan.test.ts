import { describe, expect, it } from 'vitest'

import { followUpChecks, lintAllFixable, parseVerifyArgs, planVerify, relatedTestCommand } from './verify-plan'

const packages = ['packages/stage-ui', 'apps/stage-tamagotchi']
const file = (path: string, deleted = false) => ({ path, deleted })

describe('planVerify', () => {
  it('typechecks affected packages when only package files changed', () => {
    const plan = planVerify([file('packages/stage-ui/src/a.ts'), file('docs/readme.md')], packages)
    expect(plan.typecheck).toEqual({ kind: 'affected' })
    expect(plan.lintFiles).toEqual(['packages/stage-ui/src/a.ts', 'docs/readme.md'])
    expect(plan.testFiles).toEqual(['packages/stage-ui/src/a.ts', 'scripts/dev-tools/storage-writes.test.ts'])
    expect(plan.testPackagePaths).toEqual(['packages/stage-ui'])
  })

  it('lists each package with a changed code file once', () => {
    const plan = planVerify([file('packages/stage-ui/src/a.ts'), file('packages/stage-ui/src/b.vue'), file('apps/stage-tamagotchi/src/c.ts'), file('apps/stage-tamagotchi/README.md')], packages)
    expect(plan.testPackagePaths).toEqual(['packages/stage-ui', 'apps/stage-tamagotchi'])
  })

  it('runs no test for a documentation-only change in a package', () => {
    const plan = planVerify([file('packages/stage-ui/README.md'), file('apps/stage-tamagotchi/docs/notes.mdx')], packages)
    expect(plan.testFiles).toEqual([])
    expect(plan.testPackagePaths).toEqual([])
  })

  it('typechecks every package when a root config file changed', () => {
    expect(planVerify([file('tsconfig.json')], packages).typecheck).toEqual({ kind: 'all', reason: 'tsconfig.json changed' })
    expect(planVerify([file('pnpm-lock.yaml')], packages).typecheck.kind).toBe('all')
  })

  it('plans the directory scope when the change is confined to a root dependency', () => {
    const withSlots = [...packages, 'packages/root-dependency']
    expect(planVerify([file('packages/root-dependency/src/index.ts')], withSlots, ['packages/root-dependency']).typecheck)
      .toEqual({ kind: 'all', reason: 'packages/root-dependency/src/index.ts is in a root dependency' })
  })

  it('keeps the affected scope for a package the root does not depend on', () => {
    expect(planVerify([file('packages/stage-ui/src/a.ts')], [...packages, 'packages/root-dependency'], ['packages/root-dependency']).typecheck)
      .toEqual({ kind: 'affected' })
  })

  it('treats a nested package.json as a package change, not a root change', () => {
    expect(planVerify([file('packages/stage-ui/package.json')], packages).typecheck).toEqual({ kind: 'affected' })
  })

  it('skips typecheck and package tests for root-only code', () => {
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
    const plan = planVerify([file('packages/stage-ui/README.md'), file('packages/root-dependency/docs/notes.mdx')], [...packages, 'packages/root-dependency'], ['packages/root-dependency'])
    expect(plan.typecheck).toEqual({ kind: 'none' })
    expect(plan.typecheckPackagePaths).toEqual([])
    expect(plan.lintFiles).toEqual(['packages/stage-ui/README.md', 'packages/root-dependency/docs/notes.mdx'])
  })

  it('runs the storage write scan when a renderer source changes', () => {
    expect(planVerify([file('apps/stage-tamagotchi/src/renderer/pages/chat.vue')], packages).testFiles)
      .toEqual(['apps/stage-tamagotchi/src/renderer/pages/chat.vue', 'scripts/dev-tools/storage-writes.test.ts'])
    expect(planVerify([file('apps/stage-tamagotchi/src/main/index.ts')], packages).testFiles).toEqual(['apps/stage-tamagotchi/src/main/index.ts'])
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

describe('perf follow-ups', () => {
  it('lists the perf follow-up for render-loop code and for a work budget file', () => {
    expect(followUpChecks([file('packages/motion-driver-humanoid/src/x.ts')]).some(line => line.endsWith('(render-loop code changed)'))).toBe(true)
    expect(followUpChecks([file('packages/stage-ui-mmd/src/composables/mmd/work-budget.json')]).some(line => line.endsWith('(a headless work budget changed)'))).toBe(true)
  })
})

describe('relatedTestCommand', () => {
  it('keeps the config and project selection of the package script', () => {
    expect(relatedTestCommand('vitest run')).toEqual({ env: {}, args: ['related', '--run', '--passWithNoTests'] })
    expect(relatedTestCommand('vitest run --config ./vitest.config.ts')).toEqual({ env: {}, args: ['related', '--run', '--passWithNoTests', '--config', './vitest.config.ts'] })
    expect(relatedTestCommand('vitest run --project unit')).toEqual({ env: {}, args: ['related', '--run', '--passWithNoTests', '--project', 'unit'] })
  })

  it('keeps the variables the script sets before Vitest', () => {
    expect(relatedTestCommand('NODE_OPTIONS=--no-node-snapshot vitest run')).toEqual({ env: { NODE_OPTIONS: '--no-node-snapshot' }, args: ['related', '--run', '--passWithNoTests'] })
  })

  it.each(['pnpm run build:targets && vitest run', 'vitest', 'vitest run; echo done', 'dotnet test'])('refuses a script that is not a plain vitest run: %s', (script) => {
    expect(relatedTestCommand(script)).toBeNull()
  })
})

describe('parseVerifyArgs', () => {
  it('defaults to every step against main', () => {
    expect(parseVerifyArgs([])).toEqual({ ok: true, args: { base: 'main', steps: ['lint', 'typecheck', 'test'], dryRun: false, gate: false, detach: false } })
  })

  it('keeps step order canonical whatever order --only lists', () => {
    expect(parseVerifyArgs(['--only', 'test,lint', '--base', 'origin/main', '--gate'])).toEqual({ ok: true, args: { base: 'origin/main', steps: ['lint', 'test'], dryRun: false, gate: true, detach: false } })
  })

  it('rejects unknown steps, missing values, and stray arguments', () => {
    expect(parseVerifyArgs(['--only', 'build']).ok).toBe(false)
    expect(parseVerifyArgs(['--base']).ok).toBe(false)
    expect(parseVerifyArgs(['--base', '--gate']).ok).toBe(false)
    expect(parseVerifyArgs(['--no-cache']).ok).toBe(false)
    expect(parseVerifyArgs(['extra']).ok).toBe(false)
    expect(parseVerifyArgs(['--dry-run', '--detach'])).toMatchObject({ ok: false, message: expect.stringContaining('drop --detach') })
  })

  it('takes an optional run id and a timeout for --wait, and nothing else', () => {
    expect(parseVerifyArgs(['--wait'])).toMatchObject({ ok: true, args: { wait: { id: null, timeoutMs: 540_000 } } })
    expect(parseVerifyArgs(['--wait', '17-42', '--timeout', '30'])).toMatchObject({ ok: true, args: { wait: { id: '17-42', timeoutMs: 30_000 } } })
    expect(parseVerifyArgs(['--wait', '--gate']).ok).toBe(false)
    expect(parseVerifyArgs(['--wait', '--timeout', 'soon']).ok).toBe(false)
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
