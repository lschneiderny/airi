import type { GatedRun } from './lib/gated-tests'
import type { LastVerifyPass } from './verify-plan'

import { describe, expect, it } from 'vitest'

import { advanceLastPass, followUpChecks, gateQaCommand, gateQaFor, gateQaOutcome, modelTestsOutcome, parseVerifyArgs, selectVerifyScope, typecheckFilters, verifySteps } from './verify-plan'

const context = { branch: 'luke/feat/example', mergeBase: 'base', gate: false }
const entry = { tree: 'verified-tree', head: 'verified-head', recordedAt: '2026-11-10T00:00:00.000Z' }
const record: LastVerifyPass = { mergeBase: 'base', steps: { typecheck: entry, lint: entry, test: entry } }

describe.each(verifySteps)('%s scope', (step) => {
  it('uses its own verified tree even when HEAD has unverified commits', () => {
    expect(selectVerifyScope(context, { record, step, treeExists: true })).toEqual({
      mode: 'incremental',
      base: entry.tree,
      reason: `recorded ${entry.recordedAt}`,
    })
  })

  it.each([
    { name: 'missing record', record: null, treeExists: false, context },
    { name: 'missing step entry', record: { mergeBase: 'base', steps: {} }, treeExists: false, context },
    { name: 'merge base moved', record, treeExists: true, context: { ...context, mergeBase: 'new-base' } },
    { name: 'recorded tree missing', record, treeExists: false, context },
    { name: 'gate', record, treeExists: true, context: { ...context, gate: true } },
    { name: 'detached HEAD', record, treeExists: true, context: { ...context, branch: null } },
  ])('falls back to the branch for $name', ({ name, record, treeExists, context }) => {
    expect(selectVerifyScope(context, { record, step, treeExists })).toEqual({
      mode: 'branch',
      base: context.mergeBase,
      reason: name,
    })
  })

  it.each(['failed', 'skipped'] as const)('keeps every entry unchanged after a %s step', (status) => {
    expect(advanceLastPass(record, context, { step, status, entry: { ...entry, tree: 'unchecked' } })).toEqual(record)
  })

  it('records a passed fallback and advances only its own entry', () => {
    const status = 'passed'
    const next = { ...entry, tree: 'next-tree', head: 'next-head' }
    expect(advanceLastPass(null, context, { step, status, entry: next })).toEqual({
      mergeBase: context.mergeBase,
      steps: { [step]: next },
    })
    expect(advanceLastPass(record, context, { step, status, entry: next })).toEqual({
      mergeBase: context.mergeBase,
      steps: { ...record.steps, [step]: next },
    })
  })

  it('drops entries from the old merge base when a fallback passes', () => {
    expect(advanceLastPass(record, { ...context, mergeBase: 'new-base' }, { step, status: 'passed', entry })).toEqual({
      mergeBase: 'new-base',
      steps: { [step]: entry },
    })
  })

  it('never records a detached HEAD pass', () => {
    expect(advanceLastPass(null, { ...context, branch: null }, { step, status: 'passed', entry })).toBeNull()
  })
})

describe('verify gate and typecheck planning', () => {
  it('accepts gate mode with a selected step', () => {
    expect(parseVerifyArgs(['--gate', '--only', 'test'])).toMatchObject({ ok: true, args: { gate: true, steps: ['test'] } })
  })

  it('uses package directories for affected typechecks including dependents', () => {
    expect(typecheckFilters({ kind: 'affected' }, ['packages/audio', 'apps/stage-tamagotchi']))
      .toEqual(['--filter=...{./packages/audio}', '--filter=...{./apps/stage-tamagotchi}'])
    expect(typecheckFilters({ kind: 'none' }, [])).toEqual([])
    expect(typecheckFilters({ kind: 'all', reason: 'root config' }, []))
      .toEqual(['-F=./packages/*', '-F=./apps/*', '-F=./server/**', '-F=./services/*'])
  })

  it.each([
    ['apps/stage-tamagotchi/src/main/index.ts', true],
    ['packages/stage-ui-mmd/src/index.ts', true],
    ['packages/stage-ui/src/stores/chat.ts', true],
    ['packages/stage-shared/src/index.ts', true],
    ['packages/stage-pages/src/index.ts', true],
    ['packages/stage-layouts/src/index.ts', true],
    ['scripts/dev-tools/verify.ts', false],
    ['packages/stage-shared/README.md', false],
    ['apps/component-calling/src/main.ts', false],
    ['packages/stage-shared/src/index.test.ts', false],
  ])('classifies gate smoke coverage for %s', (path, expected) => {
    expect(followUpChecks([{ path, deleted: true }]).some(line => line.includes('qa:smoke'))).toBe(expected)
  })

  it.each([
    ['packages/motion-driver-natural/src/index.ts', ['AIRI_QA_RIG_FORBOOTH']],
    ['packages/stage-ui-live2d/src/composables/live2d/live2d.ts', ['qa:smoke', 'AIRI_QA_RIG_FORBOOTH']],
    ['packages/stage-ui-live2d/src/components/scene.vue', ['qa:smoke']],
    ['packages/stage-ui-mmd/src/index.ts', ['qa:smoke', 'qa:motion3d diff']],
    ['packages/lab-tools/src/t2-3d/reports/idle-acts.ts', ['inject']],
    ['docs/ai/context/testing.md', []],
  ])('names the follow-up checks for %s in rule order', (path, expected) => {
    const lines = followUpChecks([{ path, deleted: false }])
    expect(lines).toHaveLength(expected.length)
    expected.forEach((check, index) => expect(lines[index]).toContain(check))
  })

  it('drops a rule once the gate met all of its needs, and keeps a rule whose needs are only partly met', () => {
    const changed = [{ path: 'packages/stage-ui-mmd/src/index.ts', deleted: false }]
    expect(gateQaFor(changed)).toEqual(['smoke', 'model-tests', 'motion-affected'])
    const partly = followUpChecks(changed, new Set(['smoke', 'AIRI_QA_MMD_MODEL']))
    expect(partly).toHaveLength(1)
    expect(partly[0]).toContain('qa:motion3d diff')
    expect(followUpChecks(changed, new Set(['smoke', 'AIRI_QA_MMD_MODEL', 'motion-affected']))).toEqual([])
  })

  it('keeps the Live2D rule when the model tests that passed did not include the rig', () => {
    const changed = [{ path: 'packages/motion-driver-natural/src/index.ts', deleted: false }]
    expect(gateQaFor(changed)).toEqual(['model-tests'])
    expect(followUpChecks(changed, new Set(['AIRI_QA_MMD_MODEL']))).toHaveLength(1)
    expect(followUpChecks(changed, new Set(['AIRI_QA_MMD_MODEL', 'AIRI_QA_RIG_FORBOOTH']))).toEqual([])
  })

  it('never meets a rule that the gate cannot run', () => {
    const changed = [{ path: 'packages/lab-tools/src/t2-3d/reports/idle-acts.ts', deleted: false }]
    expect(gateQaFor(changed)).toEqual([])
    expect(followUpChecks(changed, new Set(['smoke', 'AIRI_QA_MMD_MODEL', 'motion-affected']))).toHaveLength(1)
  })
})

describe('gate QA', () => {
  it('runs the Linux smoke in a session of its own and stops it after', () => {
    expect(gateQaCommand('smoke', 'linux', 'base', 'verify-7')).toEqual({
      argv: ['pnpm', 'qa:display', 'run', '--name', 'verify-7', '--', 'pnpm', '--silent', 'qa:smoke'],
      after: ['pnpm', 'qa:display', 'down', '--name', 'verify-7'],
    })
    expect(gateQaCommand('smoke', 'darwin', 'base', 'verify-7')).toEqual({ argv: ['pnpm', '--silent', 'qa:smoke'] })
    expect(gateQaCommand('smoke', 'win32', 'base', 'verify-7')).toBeTypeOf('string')
    expect(gateQaCommand('motion-affected', 'linux', 'base', 'verify-7')).toEqual({ argv: ['pnpm', '--silent', 'qa:motion3d', 'affected', 'base', 'HEAD'] })
  })

  it.each([
    [0, { status: 'passed', met: ['smoke'] }],
    [1, { status: 'failed', met: [] }],
  ] as const)('reads smoke exit %i', (exitCode, expected) => {
    expect(gateQaOutcome('smoke', exitCode)).toMatchObject(expected)
  })

  it('meets only the variables of the model test files that ran', () => {
    const plan: GatedRun = { ok: true, run: [{ file: 'a.test.ts', variables: ['AIRI_QA_MMD_MODEL'] }], skipped: [{ file: 'b.test.ts', variables: ['AIRI_QA_RIG_FORBOOTH'] }] }
    expect(modelTestsOutcome(plan, 0)).toMatchObject({ status: 'passed', met: ['AIRI_QA_MMD_MODEL'] })
    expect(modelTestsOutcome(plan, 1)).toMatchObject({ status: 'failed', met: [] })
  })

  it('skips model tests when nothing is configured and fails them when a configured model is missing', () => {
    expect(modelTestsOutcome({ ok: false, reason: 'unset', message: 'AIRI_QA_MMD_MODEL is unset.' })).toMatchObject({ status: 'skipped', met: [] })
    expect(modelTestsOutcome({ ok: false, reason: 'missing', message: 'AIRI_QA_MMD_MODEL=/models/gone.pmx does not exist.' })).toMatchObject({ status: 'failed', met: [], detail: expect.stringContaining('does not exist') })
  })

  it.each([
    ['NOT AFFECTED', 0, { status: 'passed', met: ['motion-affected'] }],
    ['AFFECTED', 1, { status: 'passed', met: [] }],
    ['CANNOT TELL', 2, { status: 'passed', met: [] }],
  ] as const)('reads the affected verdict %s', (verdict, exitCode, expected) => {
    expect(gateQaOutcome('motion-affected', exitCode, `affected 0123456ab..89abcdef0: ${verdict}\n  runner roots: x\n`)).toMatchObject(expected)
  })

  it.each([
    ['a thrown error', 1, 'qa:motion3d broke: ENOENT\n'],
    ['a usage error', 2, 'Usage: qa:motion3d affected <base commit> <tip commit>\n'],
    ['a verdict with another exit code', 1, 'affected 0123456ab..89abcdef0: CANNOT TELL\n'],
    ['a crash', 134, ''],
  ])('fails qa:motion3d affected on %s', (_, exitCode, output) => {
    expect(gateQaOutcome('motion-affected', exitCode, output)).toMatchObject({ status: 'failed', met: [] })
  })
})
