import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { trajectoryGrid } from '../motion/gate/samples'
import { emotionCells, visualCheckItems } from './cells'
import { reportLimitations } from './limitations'
import { renderReport, writeReport } from './render'

const hex64 = 'a'.repeat(64)
const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

function writeJson(dir: string, name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), JSON.stringify(value))
}

function manifest(runId: string, extra: Record<string, unknown> = {}) {
  return { runId, tool: 'motion', label: runId, gitSha: 'abcdef1234567890', dirty: false, startedAt: '2026-10-20T00:00:00.000Z', endedAt: '2026-10-20T00:01:00.000Z', command: [], env: {}, artifacts: [], result: { exitCode: 0, summary: 'ok' }, ...extra }
}

/** Schema-2 review fields: a flat paired trajectory on the gate grid and parameter levels clear of the range limits. */
function review(ids: string[], peak = 0.5, baseline = 0.1, range: [number, number] = [-1, 1]) {
  const mean = Array.from<number>({ length: trajectoryGrid.points }).fill(0.2)
  return {
    trajectory: { start: trajectoryGrid.start, step: trajectoryGrid.step, mean, low: mean.map(value => value - 0.02), high: mean.map(value => value + 0.02), n: 10 },
    levels: ids.map(id => ({ id, baseline, peak, extreme: peak, min: range[0], max: range[1] })),
  }
}

function check(emotion: string, band: string, channel: string, overrides: Record<string, unknown> = {}) {
  return {
    key: `${emotion}:${band}:${channel}`,
    verdict: 'pass',
    emotion,
    band,
    channel,
    unsigned: false,
    n: 10,
    rejected: 0,
    E: 0.2,
    ci: [0.15, 0.25],
    d: 2,
    hits: 8,
    hitRate: 0.8,
    p: 0.00001,
    pHolm: 0.001,
    expected: 0.21,
    sizeRatio: 0.95,
    failed: [],
    reasons: [],
    residual: { c: 0.001, A: 0.2, late: 0.002, lateCi: [-0.01, 0.01] },
    tau: 1.2,
    tauCi: [0.9, 1.6],
    ...review([`Param${channel}`]),
    ...overrides,
  }
}

const failingCells = ['sad:clear', 'angry:strong']

function gateReport() {
  return {
    reportSchema: 2,
    gateId: 'natural-emotion',
    version: 1,
    fileSha: '25285fbd49a5135acb082edaf43574af4f438283',
    inputHash: hex64,
    level: 't1',
    limitation: 'gate limitation text',
    pass: false,
    nullStats: { browMean: { sigma0: 0.03, q: 0.05, n: 100 }, eyelid: { sigma0: 0.02, q: 0.03, n: 100 }, blinkRate: { sigma0: 0.1, q: 0.15, n: 100 }, angleY: { sigma0: 0.2, q: 0.25, n: 100 } },
    results: [
      check('happy', 'clear', 'browMean'),
      check('happy', 'clear', 'angleY'),
      check('sad', 'clear', 'browMean', { verdict: 'fail', failed: ['release'], reasons: ['release: tau CI includes 3 x nominal'] }),
      // Modulation checks carry no sample trajectory or levels, as the producer writes them.
      check('sad', 'clear', 'blinkRate', { expected: null, sizeRatio: null, residual: { c: null, A: null, late: null, lateCi: null, ratio: 1.02 }, trajectory: null, levels: null }),
      check('angry', 'strong', 'eyelid', { verdict: 'fail', failed: ['visibility', 'release'], E: 0.01, ci: [0.005, 0.015], expected: null, sizeRatio: null, reasons: ['size: the rig range leaves no headroom for the expected effect'] }),
      check('love', 'clear', 'browMean', { sizeRatio: 1.42 }),
      // The verifier's counterexamples: a large effect that stays mid-range is not near a limit; a small effect from a high baseline is.
      check('surprised', 'clear', 'cheek', { E: 1, ci: [0.99, 1.01], sizeRatio: 1, ...review(['ParamCheek'], 0.5, 0, [0, 1]) }),
      check('think', 'clear', 'cheek', { E: 0.1, ci: [0.09, 0.11], sizeRatio: 1, ...review(['ParamCheek'], 0.95, 0.9, [0, 1]) }),
      check('sleepy', 'clear', 'eyelid', { E: -0.4, ci: [-0.45, -0.35], expected: -0.4, sizeRatio: 1, ...review(['ParamEyeLOpen', 'ParamEyeROpen'], 0.03, 0.9, [0, 1]) }),
      check('question', 'clear', 'angleY', { trajectory: null, levels: null }),
      // Resting at the limit and barely moving away from it is not a clipped face.
      check('awkward', 'slight', 'eyeSmile', { E: 0.05, ci: [0.04, 0.06], sizeRatio: 1, ...review(['ParamEyeLSmile', 'ParamEyeRSmile'], 0.05, 0, [0, 1]) }),
    ],
    determinismHash: hex64,
    selection: { seedsLimit: null, emotions: ['happy', 'sad', 'angry', 'love', 'think'], bands: ['clear', 'strong'] },
  }
}

function trajectoryPartial(emotion: string, band: string, channel: string, seedCount: number) {
  const grid = 180
  return {
    kind: 'emotion-cell',
    emotion,
    band,
    variant: 'held-only',
    seeds: { start: 1, count: seedCount },
    records: Array.from({ length: seedCount }, (_, seed) => ({
      trialId: `${emotion}-${band}-${seed + 1}`,
      emotion,
      band,
      variant: 'held-only',
      side: null,
      rejected: null,
      releaseStart: 4,
      faceResidue: 2.5,
      channels: { [channel]: { value: 0.2, paired: 0, trajectory: Array.from({ length: grid }, (_, index) => 0.2 * Math.exp(-index / 60) + (seed % 2 === 0 ? 0.01 : -0.01)) } },
      missing: {},
    })),
  }
}

describe('renderReport', () => {
  let root: string
  let gateDir: string
  let t3Dir: string
  let testDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'qa-report-'))
    gateDir = join(root, '20261020-000000-motion-gate-emotion-t1')
    writeJson(gateDir, 'run.json', manifest('20261020-000000-motion-gate-emotion-t1', { gate: { id: 'natural-emotion', version: '1', fileSha: '25285fbd49a5135acb082edaf43574af4f438283' }, result: { exitCode: 1, summary: '2 check(s) failed' } }))
    writeJson(gateDir, 'report.json', gateReport())
    writeJson(join(gateDir, 'partials'), 'emotion-happy-clear-held-only.json', trajectoryPartial('happy', 'clear', 'browMean', 6))
    writeJson(join(gateDir, 'partials'), 'emotion-angry-strong-held-only.json', trajectoryPartial('angry', 'strong', 'eyelid', 6))

    t3Dir = join(root, '20261020-000100-motion-t3-t3-smoke')
    writeJson(t3Dir, 'run.json', manifest('20261020-000100-motion-t3-t3-smoke', { env: { AIRI_QA_RIG_FORBOOTH: 'C:/rigs/forbooth' } }))
    writeJson(t3Dir, 'scenario.json', { version: 1, id: 't3-smoke', seed: 1, durationSeconds: 40, levels: ['t1', 't3'], screenshotsAt: [5, 7, 19], events: [{ kind: 'emotion', at: 4, emotion: 'happy', band: 'clear' }, { kind: 'emotion', at: 18, emotion: 'sad', band: 'clear' }] })
    writeJson(t3Dir, 'screenshots.json', [{ at: 5, file: '01-5.0s.png', actualAt: 5.01 }, { at: 7, file: '02-7.0s.png', actualAt: 7.02 }, { at: 19, file: '03-19.0s.png', actualAt: 19.01 }])
    writeJson(t3Dir, 'bridge.json', { rig: { name: 'forbooth' } })
    writeJson(t3Dir, 'verification.json', { ok: true, failures: [] })
    mkdirSync(join(t3Dir, 'screenshots'))
    for (const file of ['01-5.0s.png', '02-7.0s.png', '03-19.0s.png'])
      writeFileSync(join(t3Dir, 'screenshots', file), onePixelPng)

    testDir = join(root, '20261020-000200-test-all')
    writeJson(testDir, 'run.json', manifest('20261020-000200-test-all', { tool: 'test', label: 'all' }))
    writeJson(testDir, 'summary.json', {
      registry: 'C:/repo/packages/qa-tools/known-failures.json',
      exitCode: 1,
      counts: [{ target: { package: '@proj-airi/stage-ui', project: 'node' }, passed: 10, failed: 2, skipped: 0 }],
      suiteErrors: [],
      diff: {
        newFailures: [{ package: '@proj-airi/stage-ui', project: 'node', file: 'src/a.test.ts', name: 'suite > new one', status: 'failed', firstError: 'AssertionError: expected 1 to be 2' }],
        knownFailing: [{ entry: { package: '@proj-airi/stage-ui', project: 'node', file: 'src/b.test.ts', name: 'suite > known one', reason: 'pre-existing at base', since: '2026-10-20', removeWhen: 'fixed' }, result: { package: '@proj-airi/stage-ui', project: 'node', file: 'src/b.test.ts', name: 'suite > known one', status: 'failed' } }],
        fixedKnown: [],
        flakyPassed: [],
      },
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const now = () => new Date('2026-10-20T12:00:00.000Z')

  it('renders fixture run dirs into one self-contained page', () => {
    const rendered = renderReport({ runDirs: [gateDir, t3Dir, testDir], now })
    const { html } = rendered

    expect(rendered.issues).toEqual([])
    expect(html).toContain('id="verdict-happy-clear"')
    expect(html).toContain('id="verdict-sad-clear"')
    expect(html).toContain('id="traj-angry-strong"')
    // One release overlay for happy:clear browMean; none for angry:strong eyelid, whose grids are not in log-ratio units.
    expect((html.match(/<polyline class="release"/g) ?? []).length).toBe(1)
    expect(html).toContain('data:image/png;base64,')
    expect((html.match(/<figure class="shot">/g) ?? []).length).toBe(3)
    expect(html).toContain('+1.0 s after the pulse')
    expect(html).toContain('watermark')
    expect(html).toContain('id="known-failures"')
    expect(html).toContain('suite &gt; new one')
    expect(html).toContain('25285fbd49')
  })

  it('contains the limitations constant verbatim', () => {
    const { html } = renderReport({ runDirs: [gateDir], now })
    expect(html).toContain(reportLimitations)
  })

  it('loads nothing from a URL', () => {
    const { html } = renderReport({ runDirs: [gateDir, t3Dir, testDir], now })
    expect(html).not.toContain('src="http')
    expect(html).not.toContain('href="http')
    expect(html).not.toContain('url(http')
  })

  it('draws the paired mean trajectory from report.json alone, one polyline per channel that has one', () => {
    rmSync(join(gateDir, 'partials'), { recursive: true, force: true })
    const rendered = renderReport({ runDirs: [gateDir], now })

    const withTrajectory = gateReport().results.filter(result => result.trajectory !== null).length
    expect(withTrajectory).toBeGreaterThan(0)
    expect((rendered.html.match(/<polyline class="traj"/g) ?? []).length).toBe(withTrajectory)
    expect((rendered.html.match(/<polygon class="traj-band"/g) ?? []).length).toBe(withTrajectory)
    expect(rendered.html).not.toContain('<polyline class="release"')
    expect(rendered.issues).toEqual([])
  })

  it('lists every failing cell and the size or range outliers for the visual check', () => {
    const rendered = renderReport({ runDirs: [gateDir], now })
    for (const key of failingCells) {
      expect(rendered.visualCheck).toContain(key)
      expect(rendered.html).toContain(`id="visual-${key.replace(':', '-')}"`)
    }
    expect(rendered.visualCheck).toContain('love:clear')
    expect(rendered.visualCheck).toContain('think:clear')
    expect(rendered.visualCheck).not.toContain('happy:clear')
    expect(rendered.visualCheck).not.toContain('awkward:slight')
  })

  it('flags a face parameter by its absolute peak against the rig range, not by effect size', () => {
    const { cells } = emotionCells(JSON.parse(JSON.stringify(gateReport())), [])
    const items = visualCheckItems(cells)
    const reasons = (key: string) => items.find(item => item.key === key)?.reasons ?? []

    // cheek [0, 1], baseline 0, E = 1 half-range unit: the peak is 0.5, mid-range, so no range flag.
    expect(reasons('surprised:clear')).toEqual([])
    // cheek [0, 1], baseline 0.9, E = 0.1: the peak is 0.95, within 5% of the maximum.
    expect(reasons('think:clear')).toEqual([expect.stringContaining('ParamCheek peaks at 0.95 in [0, 1], within 5% of the maximum')])
    // Eyelid levels are raw lid openness: a peak of 0.03 in [0, 1] is within 5% of the minimum (eyes nearly shut).
    expect(reasons('sleepy:clear')).toEqual([expect.stringContaining('ParamEyeLOpen peaks at 0.03 in [0, 1], within 5% of the minimum'), expect.stringContaining('ParamEyeROpen')])
    // A row without levels cannot be judged and is not flagged by guesswork.
    expect(reasons('question:clear')).toEqual([])
    // eyeSmile [0, 1] resting at 0 and peaking at 0.05 moved away from the minimum, so no flag.
    expect(reasons('awkward:slight')).toEqual([])
  })

  it('keeps a failing row that does not parse: named as an input problem, listed for the visual check, exit 1 for the CLI', () => {
    const report: Record<string, unknown> = {
      ...gateReport(),
      results: [
        { key: 'sad:clear:browMean', verdict: 'fail', emotion: 'sad', band: 'clear', channel: 'browMean', E: 'broken', failed: ['release'] },
        check('happy', 'clear', 'browMean'),
      ],
    }
    writeJson(gateDir, 'report.json', report)
    const rendered = renderReport({ runDirs: [gateDir], now })

    expect(rendered.issues).toEqual([expect.objectContaining({ file: 'report.json', problem: expect.stringContaining('sad:clear:browMean') })])
    expect(rendered.visualCheck).toEqual(['sad:clear:browMean'])
    expect(rendered.html).toContain('result row could not be read')
    expect(rendered.html).toContain('id="visual-sad-clear-browMean"')
    expect(rendered.html).toContain('id="verdict-happy-clear"')
  })

  it('names the missing inputs of a run dir without report.json instead of an empty table', () => {
    const bare = join(root, 'bare-run')
    writeJson(bare, 'run.json', manifest('bare-run'))
    const rendered = renderReport({ runDirs: [bare], now })

    expect(rendered.issues.map(issue => issue.file)).toContain('report.json')
    expect(rendered.html).toContain('No usable input')
    expect(rendered.html).toContain('report.json')
    expect(rendered.html).not.toContain('id="verdict-')
  })

  it('reports a corrupt report.json and a nonexistent directory as named issues', () => {
    const corrupt = join(root, 'corrupt-run')
    writeJson(corrupt, 'run.json', manifest('corrupt-run'))
    writeFileSync(join(corrupt, 'report.json'), '{ "gateId": ')
    const rendered = renderReport({ runDirs: [corrupt, join(root, 'does-not-exist')], now })

    expect(rendered.issues).toContainEqual(expect.objectContaining({ run: 'corrupt-run', file: 'report.json', problem: expect.stringContaining('not valid JSON') }))
    expect(rendered.issues).toContainEqual(expect.objectContaining({ run: 'does-not-exist', problem: 'run directory does not exist' }))
    expect(rendered.html).toContain('corrupt-run/report.json')
  })

  it('judges a cell by its gated checks only and shows not-gated rows with their reason', () => {
    const report = {
      ...gateReport(),
      gateId: 'natural-emotion-t3',
      level: 't3',
      results: [
        check('angry', 'strong', 'browMean', { gated: true, transferRatio: 1.01 }),
        check('angry', 'strong', 'angleY', { gated: false, verdict: 'n/a', reasons: ['posture: reported, not gated at T3'] }),
        check('angry', 'strong', 'cheek', { gated: false, verdict: 'n/a', reasons: ['rig: trace has no ParamCheek column; not gated'] }),
      ],
    }
    writeJson(gateDir, 'report.json', report)
    rmSync(join(gateDir, 'partials'), { recursive: true, force: true })

    const [cell] = emotionCells(JSON.parse(readFileSync(join(gateDir, 'report.json'), 'utf8')), []).cells
    expect(cell.verdict).toBe('pass')
    expect(visualCheckItems([cell])).toEqual([])
    const { html } = renderReport({ runDirs: [gateDir], now })
    const row = html.slice(html.indexOf('id="verdict-angry-strong"'), html.indexOf('</tr>', html.indexOf('id="verdict-angry-strong"')))
    expect(row).toContain('badge pass')
    expect(row).toContain('1 pass, 0 fail, 0 n/a, 2 not gated')
    expect(html).toContain('not gated')
    expect(html).toContain('posture: reported, not gated at T3')
  })

  it('shows a T3 session that never captured as such, with its failure reason, not as missing inputs', () => {
    const session = join(root, '20261020-000300-motion-t3-t3-idle-liveliness-3')
    writeJson(session, 'run.json', manifest('20261020-000300-motion-t3-t3-idle-liveliness-3', { label: 't3-t3-idle-liveliness-3', result: { exitCode: 1, summary: 'failed: Cursor parking failed: the cursor is at 106,0 after parking, not 0,0' } }))
    writeJson(session, 'scenario.json', { version: 1, id: 't3-idle-liveliness-3', seed: 3, durationSeconds: 599, levels: ['t1', 't3'], events: [] })
    const rendered = renderReport({ runDirs: [gateDir, session], now })

    expect(rendered.issues).toEqual([])
    expect(rendered.html).toContain('session not captured')
    expect(rendered.html).toContain('Cursor parking failed: the cursor is at 106,0 after parking')
  })

  it('writes <firstRunDir>/report.html deterministically and overwrites an earlier report', () => {
    writeFileSync(join(gateDir, 'report.html'), 'stale')
    const first = writeReport({ runDirs: [gateDir, t3Dir], now })
    const second = writeReport({ runDirs: [gateDir, t3Dir], now })

    expect(first.outFile).toBe(join(gateDir, 'report.html'))
    expect(readFileSync(first.outFile, 'utf8')).toBe(first.html)
    expect(second.html).toBe(first.html)
  })
})
