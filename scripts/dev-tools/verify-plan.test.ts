import { describe, expect, it } from 'vitest'

import { parseVerifyArgs, planVerify } from './verify-plan'

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
