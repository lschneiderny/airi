import type { EmotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import type { LivelinessGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import type { LivelinessReport } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/liveliness'

import type { GateSelection } from './options'
import type { EmotionCellPartial, LivelinessPartial, NullPartial } from './partials'
import type { GateReport } from './report'

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { scoreEmotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import { buildEmotionChecks } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import { aggregateLivelinessReports, scoreLiveliness } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/liveliness'

import { expectedEmotionPartials, livelinessPartialName, nullPartialName } from './options'
import { readPartial } from './partials'
import { currentReportSchema, parseGateReport } from './report'
import { reviewFieldsFor } from './review-fields'

export interface AggregateContext {
  runDir: string
  /** Git blob SHA of `gates.ts`, the file that holds the gate's rules. */
  fileSha: string
  level: 't1' | 't2'
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

function assertPartials(runDir: string, names: readonly string[]): void {
  const missing = names.filter(name => !existsSync(join(runDir, 'partials', name)))
  if (missing.length)
    throw new Error(`[qa-tools] ${missing.length} expected partial(s) missing from ${runDir}: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}`)
}

/** Hash of every partial's bytes in name order; equal inputs give an equal hash whatever the worker count. */
function hashPartials(runDir: string, names: readonly string[]): string {
  const hash = createHash('sha256')
  for (const name of [...names].sort())
    hash.update(`${name}\0${sha256(readFileSync(join(runDir, 'partials', name)))}\n`)
  return hash.digest('hex')
}

/** Everything in the report except timings and the hash itself; the hash covers exactly this. */
function seal(body: Omit<GateReport, 'determinismHash'>): GateReport {
  return parseGateReport({ ...body, determinismHash: sha256(JSON.stringify(body)) })
}

/** Scores the partials of an emotion run: Holm across every check of the selection, null stats per channel. */
export function aggregateEmotion(context: AggregateContext, gate: EmotionGate, selection: GateSelection): GateReport {
  const names = expectedEmotionPartials(selection)
  assertPartials(context.runDir, names)
  const cells = names.filter(name => name !== nullPartialName).map(name => readPartial<EmotionCellPartial>(context.runDir, name, 'emotion-cell'))
  const nullPartial = readPartial<NullPartial>(context.runDir, nullPartialName, 'null')
  const checks = buildEmotionChecks().filter(check => selection.emotions.includes(check.emotion) && selection.bands.includes(check.band))
  const score = scoreEmotionGate({ gate, checks, trials: cells.flatMap(cell => cell.records), placebos: nullPartial.records, ranges: nullPartial.ranges })
  // Review fields (schema 2) ride along each verdict; they read the cells' samples and never touch the score.
  const checksByKey = new Map(checks.map(check => [check.key, check]))
  const results = score.results.map((result) => {
    const check = checksByKey.get(result.key)
    return check ? { ...result, ...reviewFieldsFor(check, cells, gate) } : result
  })
  return seal({
    reportSchema: currentReportSchema,
    gateId: gate.id,
    version: gate.version,
    fileSha: context.fileSha,
    inputHash: hashPartials(context.runDir, names),
    level: context.level,
    limitation: score.limitation,
    pass: score.pass,
    nullStats: score.nullStats as GateReport['nullStats'],
    results,
    selection: { emotions: [...selection.emotions], bands: [...selection.bands], seedsLimit: selection.seedsLimit },
    seeds: gate.seeds,
  } as Omit<GateReport, 'determinismHash'>)
}

/** Scores the three idle traces and judges them on the gate's own metric list, as the committed liveliness test does. */
export function aggregateLiveliness(context: AggregateContext, gate: LivelinessGate): GateReport {
  const names = gate.seeds.map(livelinessPartialName)
  assertPartials(context.runDir, names)
  const reports: LivelinessReport[] = names.map((name) => {
    const { trace } = readPartial<LivelinessPartial>(context.runDir, name, 'liveliness-trace')
    return scoreLiveliness(trace, trace.ranges, { mode: 'generated' })
  })
  const aggregate = aggregateLivelinessReports(reports)
  const results = [
    ...aggregate.hardFailures.map(failure => ({ key: `hard:${failure}`, verdict: 'fail' as const })),
    ...gate.metrics.map(id => ({
      key: id,
      verdict: aggregate.metrics[id]?.pass === true ? 'pass' as const : 'fail' as const,
      value: aggregate.metrics[id]?.value ?? null,
      band: aggregate.metrics[id]?.band ?? null,
    })),
  ]
  return seal({
    reportSchema: currentReportSchema,
    gateId: gate.id,
    version: gate.version,
    fileSha: context.fileSha,
    inputHash: hashPartials(context.runDir, names),
    level: context.level,
    limitation: gate.limitation,
    pass: results.every(result => result.verdict === 'pass'),
    nullStats: {},
    results,
    simulation: { seeds: gate.seeds, warmUpSeconds: gate.warmUpSeconds, scoredSeconds: gate.scoredSeconds },
  })
}

/** Plain-text summary: one line per cell (emotion and band) with its verdicts, then every failed check. */
export function formatSummary(report: GateReport): string {
  const lines = [`${report.gateId} v${report.version} (${report.level}): ${report.pass ? 'PASS' : 'FAIL'}`]
  const cells = new Map<string, { pass: number, fail: number, na: number }>()
  for (const result of report.results) {
    const cell = typeof result.emotion === 'string' && typeof result.band === 'string' ? `${result.emotion}:${result.band}` : 'metrics'
    const tally = cells.get(cell) ?? { pass: 0, fail: 0, na: 0 }
    if (result.verdict === 'pass')
      tally.pass++
    else if (result.verdict === 'fail')
      tally.fail++
    else
      tally.na++
    cells.set(cell, tally)
  }
  for (const [cell, tally] of cells)
    lines.push(`  ${cell.padEnd(20)} ${tally.pass} pass, ${tally.fail} fail, ${tally.na} n/a`)
  const failed = report.results.filter(result => result.verdict !== 'pass')
  if (failed.length) {
    lines.push('Failed or incomplete checks:')
    for (const result of failed) {
      const failedCriteria = Array.isArray(result.failed) ? result.failed.map(String) : []
      const reasonList = Array.isArray(result.reasons) ? result.reasons.map(String) : []
      const detail = failedCriteria.length ? `failed=${failedCriteria.join(',')}` : result.value !== undefined ? `value=${String(result.value)} band=${JSON.stringify(result.band)}` : ''
      const reasons = reasonList.length ? ` (${reasonList.join('; ')})` : ''
      lines.push(`  ${result.verdict.padEnd(4)} ${result.key} ${detail}${reasons}`.trimEnd())
    }
  }
  lines.push(`determinismHash ${report.determinismHash}`, `Limitation: ${report.limitation}`)
  return `${lines.join('\n')}\n`
}
