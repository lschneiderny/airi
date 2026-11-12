import process from 'node:process'

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { encodeBlock } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as v from 'valibot'

import { popsMotion3d } from './cli/pops'
import { verdictsMotion3d } from './cli/verdicts'
import { analyticTrace } from './metrics/test-trace'
import { caseReport, judged, notExercised } from './reports/case-report'
import { criterionReport, formatReport, requirement } from './reports/report'
import { gateStub, TEST_BONES } from './reports/test-runs'
import { takeJsonOption, verdictFileSchema, VerdictRecorder } from './verdicts'

const repoRoot = resolve(import.meta.dirname, '../../../..')

describe('verdict files', () => {
  let root = ''
  let printed: string[] = []
  const context = (verdicts?: VerdictRecorder) => ({ repoRoot, cwd: root, signal: new AbortController().signal, verdicts })
  const read = async (path: string) => v.parse(verdictFileSchema, JSON.parse(await readFile(path, 'utf8')))

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'motion3d-verdicts-'))
    printed = []
    vi.spyOn(console, 'info').mockImplementation((line: string) => printed.push(line))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('takes --json and its path off the arguments and refuses a bare --json', () => {
    expect(takeJsonOption(['run-a', '--json', 'out.json', '--idle', 'run-b'])).toEqual({ args: ['run-a', '--idle', 'run-b'], path: 'out.json' })
    expect(takeJsonOption(['run-a', '--json'])).toHaveProperty('error')
  })

  it('writes the verdict and exit code of a report command through the shared report runner', async () => {
    const input = analyticTrace({ seconds: 4, bones: TEST_BONES, scenario: 'talk' })
    await mkdir(join(root, 'run'))
    await writeFile(join(root, 'run', 'trace.json'), JSON.stringify({ ...input.trace, rot: encodeBlock(input.rot), root: encodeBlock(input.root), channels: encodeBlock(input.channels) }))
    const recorder = new VerdictRecorder('pops', join(root, 'pops.verdict.json'))
    const code = await recorder.finish(await popsMotion3d(['run'], context(recorder)))
    const file = await read(join(root, 'pops.verdict.json'))
    expect(code).toBe(0)
    expect(file).toMatchObject({ report: 'pops', reportVersion: 2, verdict: 'PASS', exitCode: 0 })
    expect(file.lines.map(line => [line.id, line.status])).toEqual([['upper-body-pops', 'PASS']])
    expect(file.inputs).toEqual([{ run: join(root, 'run'), commit: null, modelSha256: null, scenario: 'analytic (talk)', seed: 1 }])
  })

  it('takes its verdict from the final exit code, which a wrapper may turn into a refusal', async () => {
    const recorder = new VerdictRecorder('ownership', join(root, 'own.verdict.json'))
    recorder.criterion(criterionReport('ownership', 2, [], [], [requirement('runs', 'six seeds', '5', false)], null), root, [])
    expect(await recorder.finish(2)).toBe(2)
    expect(await read(join(root, 'own.verdict.json'))).toMatchObject({ verdict: 'REFUSED', exitCode: 2 })
  })

  it('refuses --json on a command that records no verdict', async () => {
    const recorder = new VerdictRecorder('run', join(root, 'run.verdict.json'))
    expect(await recorder.finish(0)).toBe(2)
    expect(await read(join(root, 'run.verdict.json'))).toMatchObject({ verdict: 'REFUSED', exitCode: 2, lines: [] })
  })

  it('names a failing line that comes after enough passing text to fall past a cut summary line', async () => {
    const passing = Array.from({ length: 12 }, (_, i) => requirement(`requirement-${i}`, 'a rule long enough to fill a terminal line on its own', `value ${i}`, true))
    const report = criterionReport('gesture-timing', 4, [], [], [...passing, requirement('pops', 'upper-body pop count = 0', '2', false)], null)
    expect(formatReport(report, []).indexOf('FAIL pops')).toBeGreaterThan(200)
    const recorder = new VerdictRecorder('gesture-timing', join(root, 'walk.verdict.json'))
    recorder.criterion(report, join(root, 'walk-1'), [])
    await recorder.finish(1)
    expect(await verdictsMotion3d([root], context())).toBe(1)
    expect(printed.find(line => line.startsWith('FAIL gesture-timing'))).toContain('lines with FAIL/REFUSED: pops FAIL [walk-1]')
  })

  it('treats a missing, unparsable or foreign verdict file as an error, never a pass', async () => {
    await writeFile(join(root, 'cut.verdict.json'), '{"kind": "motion3d-verdict", "verdict": "PA')
    await writeFile(join(root, 'other.json'), JSON.stringify({ kind: 'motion3d-verdict', version: 1, report: 'pops' }))
    expect(await verdictsMotion3d(['cut.verdict.json'], context())).toBe(2)
    expect(await verdictsMotion3d(['other.json'], context())).toBe(2)
    expect(await verdictsMotion3d(['absent.verdict.json'], context())).toBe(2)
    await mkdir(join(root, 'empty'))
    expect(await verdictsMotion3d(['empty'], context())).toBe(2)
  })

  it('gates on any line status named by --fail-on, such as a skipped gate metric', async () => {
    const recorder = new VerdictRecorder('gate', join(root, 'gate.verdict.json'))
    recorder.gate(join(root, 'idle-1'), gateStub({ 'smooth.head.ldlj': { status: 'PASS', value: -9 }, 'period.head.loopPeak': { status: 'SKIPPED' } }), null)
    await recorder.finish(0)
    expect(await verdictsMotion3d(['gate.verdict.json'], context())).toBe(0)
    expect(await verdictsMotion3d(['gate.verdict.json', '--fail-on', 'SKIPPED'], context())).toBe(1)
    expect(printed.at(-2)).toContain('period.head.loopPeak SKIPPED [idle-1]')
  })

  it('writes a NOT-EXERCISED line with the status the report prints, and lists it only when --fail-on names it', async () => {
    const recorder = new VerdictRecorder('rest', join(root, 'rest.verdict.json'))
    recorder.criterion(caseReport('rest', 3, [], [], [judged('rest-posture', 'pitch above baseline', '2.1 deg', true), notExercised('doze-head', 'a nod-off in the doze', 'no clean rule')], null), join(root, 'sleepy-1'), [])
    expect(await recorder.finish(1)).toBe(1)
    expect((await read(join(root, 'rest.verdict.json'))).lines.map(line => [line.id, line.status])).toEqual([['rest-posture', 'PASS'], ['doze-head', 'NOT-EXERCISED']])
    await verdictsMotion3d(['rest.verdict.json'], context())
    expect(printed.at(-2)).toContain('lines with FAIL/REFUSED: none')
    expect(await verdictsMotion3d(['rest.verdict.json', '--fail-on', 'NOT-EXERCISED'], context())).toBe(1)
    expect(printed.at(-2)).toContain('lines with NOT-EXERCISED: doze-head NOT-EXERCISED [sleepy-1]')
  })
})
