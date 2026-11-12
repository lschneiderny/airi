import { describe, expect, it } from 'vitest'

import { gatedNotice, gatedRunRefusal, gateVariables, qaGatedFiles } from './gated-tests'

const model = { file: 'packages/qa-tools/src/t2-3d/runner/run.test.ts', variables: ['AIRI_QA_MMD_MODEL'] }
const darwin = { file: 'apps/stage-tamagotchi/src/main/foreground.test.ts', variables: ['AIRI_FOREGROUND_QA_SAFARI'] }

describe('gateVariables', () => {
  it('finds runIf and negated skipIf gates and ignores a skipIf that runs when the variable is unset', () => {
    // Built from parts so the repository scan in `listGatedTestFiles` does not count this file as gated.
    const env = ['process', 'env'].join('.')
    const source = [
      `it.runIf(${env}.AIRI_QA_MMD_MODEL)('loads', () => {})`,
      `describe.runIf(Boolean(${env}.AIRI_BINDING_QA_PID))('binds', () => {})`,
      `it.skipIf(!${env}.AIRI_QA_OTHER)('other', () => {})`,
      `it.skipIf(${env}.CI)('local only', () => {})`,
      `it.runIf(${env}.AIRI_QA_MMD_MODEL)('again', () => {})`,
    ].join('\n')

    expect(gateVariables(source)).toEqual(['AIRI_QA_MMD_MODEL', 'AIRI_BINDING_QA_PID', 'AIRI_QA_OTHER'])
  })
})

describe('gatedRunRefusal', () => {
  const files = qaGatedFiles([model, darwin])

  it('runs only AIRI_QA_* gated files and refuses when their variable is unset or names a missing file', () => {
    expect(files).toEqual([model])
    expect(gatedRunRefusal(files, {}, '/repo/.env.qa', () => true)).toContain('AIRI_QA_MMD_MODEL is unset')
    expect(gatedRunRefusal(files, { AIRI_QA_MMD_MODEL: '/models/gone.pmx' }, '/repo/.env.qa', () => false)).toContain('/models/gone.pmx does not exist')
    expect(gatedRunRefusal(files, { AIRI_QA_MMD_MODEL: '/models/chisa.pmx' }, '/repo/.env.qa', () => true)).toBeNull()
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
