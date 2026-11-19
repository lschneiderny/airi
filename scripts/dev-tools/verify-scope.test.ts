import type { LastVerifyPass } from './verify-plan'

import { describe, expect, it } from 'vitest'

import { advanceLastPass, followUpChecks, gateQaCommand, gateQaFor, gateQaOutcome, parseVerifyArgs, selectVerifyScope, typecheckFilters, verifySteps } from './verify-plan'

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
    ['packages/qa-tools/src/t2-3d/reports/idle-acts.ts', ['inject']],
    ['docs/ai/context/testing.md', []],
  ])('names the follow-up checks for %s in rule order', (path, expected) => {
    const lines = followUpChecks([{ path, deleted: false }])
    expect(lines).toHaveLength(expected.length)
    expected.forEach((check, index) => expect(lines[index]).toContain(check))
  })

  it('drops a rule once the gate met all of its QA, and keeps a rule whose QA is only partly met', () => {
    const changed = [{ path: 'packages/stage-ui-mmd/src/index.ts', deleted: false }]
    expect(gateQaFor(changed)).toEqual(['smoke', 'model-tests', 'motion-affected'])
    const partly = followUpChecks(changed, new Set(['smoke', 'model-tests']))
    expect(partly).toHaveLength(1)
    expect(partly[0]).toContain('qa:motion3d diff')
    expect(followUpChecks(changed, new Set(['smoke', 'model-tests', 'motion-affected']))).toEqual([])
  })

  it('never meets a rule that the gate cannot run', () => {
    const changed = [{ path: 'packages/qa-tools/src/t2-3d/reports/idle-acts.ts', deleted: false }]
    expect(gateQaFor(changed)).toEqual([])
    expect(followUpChecks(changed, new Set(['smoke', 'model-tests', 'motion-affected']))).toHaveLength(1)
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
    ['smoke', 0, { status: 'passed', met: true }],
    ['smoke', 1, { status: 'failed', met: false }],
    ['model-tests', 2, { status: 'skipped', met: false }],
    ['model-tests', 1, { status: 'failed', met: false }],
    ['motion-affected', 0, { status: 'passed', met: true }],
    ['motion-affected', 1, { status: 'passed', met: false }],
    ['motion-affected', 2, { status: 'passed', met: false }],
    ['motion-affected', 134, { status: 'failed', met: false }],
  ] as const)('reads %s exit %i', (qa, exitCode, expected) => {
    expect(gateQaOutcome(qa, exitCode)).toMatchObject(expected)
  })
})
