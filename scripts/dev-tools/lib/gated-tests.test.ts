import { describe, expect, it } from 'vitest'

import { gatedNotice, gateVariables, groupByVitestConfig, planGatedRun, qaGatedFiles, skippedGatedNotice } from './gated-tests'

const model = { file: 'packages/qa-tools/src/t2-3d/runner/run.test.ts', variables: ['AIRI_QA_MMD_MODEL'] }
const rig = { file: 'packages/qa-tools/src/t2/runner.test.ts', variables: ['AIRI_QA_RIG_FORBOOTH'] }
const darwin = { file: 'apps/stage-tamagotchi/src/main/foreground.test.ts', variables: ['AIRI_FOREGROUND_QA_SAFARI'] }

// Built from parts so the repository scan in `listGatedTestFiles` does not count this file as gated.
const env = ['process', 'env'].join('.')

describe('gateVariables', () => {
  it('finds runIf and negated skipIf gates and ignores a skipIf that runs when the variable is unset', () => {
    const source = [
      `it.runIf(${env}.AIRI_QA_MMD_MODEL)('loads', () => {})`,
      `describe.runIf(Boolean(${env}.AIRI_BINDING_QA_PID))('binds', () => {})`,
      `it.skipIf(!${env}.AIRI_QA_OTHER)('other', () => {})`,
      `it.skipIf(${env}.CI)('local only', () => {})`,
      `it.runIf(${env}.AIRI_QA_MMD_MODEL)('again', () => {})`,
    ].join('\n')

    expect(gateVariables(source)).toEqual(['AIRI_QA_MMD_MODEL', 'AIRI_BINDING_QA_PID', 'AIRI_QA_OTHER'])
  })

  it('follows gate conditions through file constants and skips variables read with a fallback', () => {
    const source = [
      `const rigRoot = ${env}.AIRI_QA_RIG_FORBOOTH`,
      `const corePath = ${env}.AIRI_QA_CUBISM_CORE ?? defaultCorePath`,
      `const skipReason = !rigRoot ? 'unset' : !existsSync(corePath) ? 'missing core' : undefined`,
      `const enabled = process.platform === 'darwin' && ${env}.AIRI_FOREGROUND_MEMORY_PATH === 'native'`,
      `describe.skipIf(skipReason)('rig', () => {})`,
      `describe.runIf(enabled)('memory', () => {})`,
    ].join('\n')

    expect(gateVariables(source)).toEqual(['AIRI_QA_RIG_FORBOOTH', 'AIRI_FOREGROUND_MEMORY_PATH'])
  })

  it('counts an if that declares tests or asserts, and ignores one that only writes output', () => {
    const source = [
      `const mocapDir = ${env}.AIRI_QA_MOCAP_DIR`,
      `if (mocapDir) {`,
      `  it('reads real clips', () => {})`,
      `}`,
      `it('rebuilds', () => {`,
      `  const directory = ${env}.AIRI_QA_REFERENCE_DIR`,
      `  if (directory)`,
      `    expect(rebuild(directory)).toEqual(committed)`,
      `  const out = ${env}.EVIDENCE_DIR`,
      `  if (out)`,
      `    writeEvidence(out)`,
      `})`,
    ].join('\n')

    expect(gateVariables(source)).toEqual(['AIRI_QA_MOCAP_DIR', 'AIRI_QA_REFERENCE_DIR'])
  })
})

describe('planGatedRun', () => {
  const files = qaGatedFiles([model, rig, darwin])

  it('keeps only AIRI_QA_* gated files', () => {
    expect(files).toEqual([model, rig])
  })

  it('runs the files whose variables are set and names the others', () => {
    const plan = planGatedRun(files, { AIRI_QA_MMD_MODEL: '/models/chisa.pmx' }, '/repo/.env.qa', () => true)

    expect(plan).toEqual({ ok: true, run: [model], skipped: [rig] })
    expect(plan.ok && skippedGatedNotice(plan.skipped, {})).toBe(`skipped 1 file(s) (AIRI_QA_RIG_FORBOOTH unset): ${rig.file}`)
  })

  it('refuses when no gated file can run or a set variable names a missing path', () => {
    expect(planGatedRun(files, {}, '/repo/.env.qa', () => true)).toMatchObject({ ok: false, reason: 'unset', message: expect.stringContaining('AIRI_QA_MMD_MODEL, AIRI_QA_RIG_FORBOOTH are unset') })
    expect(planGatedRun(files, { AIRI_QA_MMD_MODEL: '/models/gone.pmx' }, '/repo/.env.qa', () => false)).toMatchObject({ ok: false, reason: 'missing', message: expect.stringContaining('/models/gone.pmx does not exist') })
  })
})

describe('gatedNotice', () => {
  it('names skipped gated files in affected packages and stays silent when none is related or the variable is set', () => {
    const notice = gatedNotice([model, darwin], ['packages/qa-tools'], [], {})

    expect(notice).toContain(model.file)
    expect(notice).not.toContain(darwin.file)
    expect(notice).toContain('pnpm qa:test:model')
    expect(gatedNotice([model], ['packages/qa'], [], {})).toBeNull()
    expect(gatedNotice([model], ['packages/qa-tools'], [], { AIRI_QA_MMD_MODEL: '/m.pmx' })).toBeNull()
    expect(gatedNotice([darwin], [], [darwin.file], {})).toContain('AIRI_FOREGROUND_QA_SAFARI unset')
  })
})

describe('groupByVitestConfig', () => {
  it('groups files under the nearest directory with a config, relative to it', () => {
    const configs = new Set(['packages/qa-tools', 'apps/stage-tamagotchi'])
    const groups = groupByVitestConfig([model.file, rig.file, darwin.file, 'scripts/dev-tools/a.test.ts'], directory => configs.has(directory))

    expect([...groups]).toEqual([
      ['packages/qa-tools', ['src/t2-3d/runner/run.test.ts', 'src/t2/runner.test.ts']],
      ['apps/stage-tamagotchi', ['src/main/foreground.test.ts']],
      ['.', ['scripts/dev-tools/a.test.ts']],
    ])
  })
})
