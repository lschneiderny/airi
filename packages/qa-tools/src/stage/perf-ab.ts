import type { AppCpuWindow } from './app-cpu'
import type { StageMeasureRecord } from './measure'

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { median, parsePerfLine } from '@proj-airi/stage-shared/perf/usage'

import { launchAndMeasure } from './measure'

/**
 * The perf recorder's overhead, measured with the stage frame measurement and `/proc` CPU instead of the recorder's
 * own numbers. Each pair launches the window stage twice on copies of one profile: arm `a` without recording, arm `b`
 * with it. The control (`--perf-ab-control`) records in both arms, so its deltas show the bias of the arm order alone.
 */

/** IS-2: recording may add at most this much app CPU, in percent of one core. */
export const PERF_AB_MAX_ADDED_CPU_PCT = 1

export type PerfAbArm = 'a' | 'b'

export interface PerfAbArmValues {
  fps: number
  p95StageMs: number
  cpuPctOfCore: number
}

export interface PerfAbPairValues {
  n: number
  a: PerfAbArmValues
  b: PerfAbArmValues
}

export interface PerfAbMetricSummary {
  /** `b - a` per complete pair, in pair order. */
  deltas: number[]
  medianDelta: number
  band: { low: number, high: number }
  /** Range (max - min) of arm `a` over the pairs: how far the same configuration moves between launches. */
  baselineSpread: number
}

export interface PerfAbSummary {
  completePairs: number
  fps: PerfAbMetricSummary
  p95StageMs: PerfAbMetricSummary
  cpuPctOfCore: PerfAbMetricSummary
  /** `null` without a complete pair. */
  verdict: { cpu: boolean, fps: boolean, p95StageMs: boolean, pass: boolean } | null
}

export interface PerfRecordCount {
  dir: string
  files: number
  records: number
  windowRollups: number
  rejectedLines: number
}

export interface PerfAbRun {
  n: number
  arm: PerfAbArm
  recording: boolean
  measure: StageMeasureRecord
  appCpu: AppCpuWindow
  /** The recorder's raw output of a recording arm; `null` for an arm that did not record. */
  perf: PerfRecordCount | null
}

export interface StagePerfAbRecord {
  kind: 'stage-perf-ab'
  version: 1
  control: boolean
  pairs: number
  seconds: number
  profile: string
  runs: PerfAbRun[]
  failures: { n: number, arm: PerfAbArm, error: string }[]
  summary: PerfAbSummary
  /** Every launch ran and every recording arm wrote window rollups; without them the recorder was not measured. */
  valid: boolean
}

function metricSummary(pairs: readonly PerfAbPairValues[], metric: keyof PerfAbArmValues): PerfAbMetricSummary {
  const deltas = pairs.map(pair => pair.b[metric] - pair.a[metric])
  const baseline = pairs.map(pair => pair.a[metric])
  if (deltas.length === 0)
    return { deltas, medianDelta: Number.NaN, band: { low: Number.NaN, high: Number.NaN }, baselineSpread: Number.NaN }
  return {
    deltas,
    medianDelta: median(deltas),
    band: { low: Math.min(...deltas), high: Math.max(...deltas) },
    baselineSpread: Math.max(...baseline) - Math.min(...baseline),
  }
}

/**
 * Median per-pair deltas and the IS-2 verdict: the median added app CPU is at most 1 % of one core, and the median fps
 * and p95 AIRI-stage deltas are no larger than the spread of the baseline arm between launches.
 */
export function summarizePerfAb(pairs: readonly PerfAbPairValues[]): PerfAbSummary {
  const fps = metricSummary(pairs, 'fps')
  const p95StageMs = metricSummary(pairs, 'p95StageMs')
  const cpuPctOfCore = metricSummary(pairs, 'cpuPctOfCore')
  if (pairs.length === 0)
    return { completePairs: 0, fps, p95StageMs, cpuPctOfCore, verdict: null }
  const cpu = cpuPctOfCore.medianDelta <= PERF_AB_MAX_ADDED_CPU_PCT
  const fpsWithin = Math.abs(fps.medianDelta) <= fps.baselineSpread
  const p95Within = Math.abs(p95StageMs.medianDelta) <= p95StageMs.baselineSpread
  return { completePairs: pairs.length, fps, p95StageMs, cpuPctOfCore, verdict: { cpu, fps: fpsWithin, p95StageMs: p95Within, pass: cpu && fpsWithin && p95Within } }
}

/** Counts the records under `<dir>/raw/*.jsonl` through the record contract's parser. */
export function countPerfRecords(dir: string): PerfRecordCount {
  const rawDir = join(dir, 'raw')
  const files = readdirSync(rawDir).filter(name => name.endsWith('.jsonl'))
  const count: PerfRecordCount = { dir, files: files.length, records: 0, windowRollups: 0, rejectedLines: 0 }
  for (const file of files) {
    for (const line of readFileSync(join(rawDir, file), 'utf8').split('\n').filter(Boolean)) {
      const parsed = parsePerfLine(line)
      if (!parsed.ok) {
        count.rejectedLines += 1
        continue
      }
      count.records += 1
      if (parsed.record.kind === 'window-rollup')
        count.windowRollups += 1
    }
  }
  return count
}

function pairValues(runs: readonly PerfAbRun[]): PerfAbPairValues[] {
  const values = (run: PerfAbRun): PerfAbArmValues => ({ fps: run.measure.result.fps, p95StageMs: run.measure.result.p95StageMs, cpuPctOfCore: run.appCpu.cpuPctOfCore })
  return runs.flatMap((a) => {
    const b = a.arm === 'a' ? runs.find(run => run.n === a.n && run.arm === 'b') : undefined
    return b ? [{ n: a.n, a: values(a), b: values(b) }] : []
  })
}

/**
 * Runs `pairs` interleaved a/b launches of the window stage, each under its own exclusive lease, and writes the
 * recorder's output of pair `n`, arm `x` to `<perfRoot>/pair-<n>-<x>`. `onRun` receives the record after every launch.
 */
export async function measurePerfAb(options: {
  repoRoot: string
  profile: string
  pairs: number
  seconds: number
  settleSeconds: number
  attempts: number
  control: boolean
  perfRoot: string
  selfPids: readonly number[]
  log: (line: string) => void
  onRun: (record: StagePerfAbRecord) => void
}): Promise<StagePerfAbRecord> {
  const record: StagePerfAbRecord = { kind: 'stage-perf-ab', version: 1, control: options.control, pairs: options.pairs, seconds: options.seconds, profile: options.profile, runs: [], failures: [], summary: summarizePerfAb([]), valid: false }
  const scratch = mkdtempSync(join(tmpdir(), 'airi-qa-perf-ab-'))
  try {
    for (let n = 1; n <= options.pairs; n += 1) {
      for (const arm of ['a', 'b'] as const) {
        const recording = options.control || arm === 'b'
        const perfDir = join(options.perfRoot, `pair-${n}-${arm}`)
        try {
          const measure = await launchAndMeasure({
            ...options,
            mode: 'window',
            n,
            scratch,
            label: `perf-ab-${arm}`,
            env: recording ? { AIRI_PERF_RECORD: '1', AIRI_PERF_DIR: perfDir } : { AIRI_PERF_RECORD: '0' },
            measureAppCpu: true,
          })
          if (!measure.appCpu)
            throw new Error('the measurement carried no app CPU window')
          record.runs.push({ n, arm, recording, measure, appCpu: measure.appCpu, perf: recording ? countPerfRecords(perfDir) : null })
        }
        catch (error) {
          const message = errorMessageFrom(error) ?? 'unknown error'
          options.log(`qa-tools stage: perf-ab arm ${arm} of pair ${n} failed: ${message}`)
          record.failures.push({ n, arm, error: message })
        }
        record.summary = summarizePerfAb(pairValues(record.runs))
        record.valid = record.failures.length === 0 && record.runs.every(run => run.measure.valid && (run.perf === null || run.perf.windowRollups > 0))
        options.onRun(record)
      }
    }
  }
  finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  return record
}
