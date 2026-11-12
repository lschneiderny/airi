import type { MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MotionVerdict } from './gate/types'
import type { CriterionReport, LoadedRun } from './reports/report'

import { writeFile } from 'node:fs/promises'

import * as v from 'valibot'

export const VERDICT_FILE_KIND = 'motion3d-verdict'
export const VERDICT_FILE_VERSION = 1

const verdictInputSchema = v.object({
  run: v.string(),
  commit: v.nullable(v.string()),
  modelSha256: v.nullable(v.string()),
  scenario: v.nullable(v.string()),
  seed: v.nullable(v.number()),
})
const verdictLineSchema = v.object({
  run: v.string(),
  id: v.string(),
  status: v.string(),
  value: v.string(),
  rule: v.string(),
  note: v.optional(v.string()),
})
/** The file `--json <path>` writes and `qa:motion3d verdicts` reads. */
export const verdictFileSchema = v.object({
  kind: v.literal(VERDICT_FILE_KIND),
  version: v.literal(VERDICT_FILE_VERSION),
  command: v.string(),
  report: v.string(),
  reportVersion: v.nullable(v.number()),
  verdict: v.picklist(['PASS', 'FAIL', 'REFUSED', 'REPORT']),
  exitCode: v.pipe(v.number(), v.integer()),
  refusals: v.array(v.string()),
  inputs: v.array(verdictInputSchema),
  lines: v.array(verdictLineSchema),
})
export type VerdictFile = v.InferOutput<typeof verdictFileSchema>
export type VerdictInput = v.InferOutput<typeof verdictInputSchema>
export type VerdictLine = v.InferOutput<typeof verdictLineSchema>

export function takeJsonOption(args: readonly string[]): { readonly args: string[], readonly path: string | null } | { readonly error: string } {
  const at = args.indexOf('--json')
  if (at < 0)
    return { args: [...args], path: null }
  const path = args[at + 1]
  if (!path || path.startsWith('-') || args.slice(at + 1).includes('--json'))
    return { error: '--json takes one file path' }
  return { args: [...args.slice(0, at), ...args.slice(at + 2)], path }
}

function inputOf(run: string, trace: MotionTraceV1 | null): VerdictInput {
  return {
    run,
    commit: trace?.source.gitSha ?? null,
    modelSha256: trace?.rig.assetSha256 ?? null,
    scenario: trace ? `${trace.source.scenario.id} (${trace.source.scenario.class})` : null,
    seed: trace?.source.scenario.seed ?? null,
  }
}

/**
 * Collects what one `qa:motion3d` command judged, and writes it once the command's FINAL exit code is known: a wrapper
 * may still turn a report's FAIL into a refusal (exit 2) after the shared report runner returns. The file's verdict
 * follows that exit code, so it can never say PASS for a command that did not exit 0.
 */
export class VerdictRecorder {
  private report: string | null = null
  private reportVersion: number | null = null
  private readonly inputs = new Map<string, VerdictInput>()
  private readonly lines: VerdictLine[] = []
  private readonly refusals: string[] = []

  constructor(readonly command: string, readonly path: string) {}

  criterion(report: CriterionReport<unknown>, dir: string, runs: readonly LoadedRun[]): void {
    this.report = report.kind
    this.reportVersion = report.version
    for (const run of runs.filter(run => report.inputs.includes(run.dir)))
      this.inputs.set(run.dir, inputOf(run.dir, run.input.trace))
    for (const r of report.requirements)
      this.lines.push({ run: dir, id: r.id, status: r.pass ? 'PASS' : 'FAIL', value: r.value, rule: r.rule })
  }

  gate(dir: string, verdict: MotionVerdict, trace: MotionTraceV1 | null): void {
    this.report = 'mmd-motion-quality'
    this.reportVersion = verdict.gate.version
    this.inputs.set(dir, inputOf(dir, trace))
    if (verdict.refusal)
      this.refusals.push(`${dir}: ${verdict.refusal.name}: ${verdict.refusal.detail}`)
    for (const m of verdict.metrics) {
      const band = m.band ? `[${m.band.lo ?? '-inf'}, ${m.band.hi ?? 'inf'}] ${m.band.transform} ${m.basis ?? ''} ${m.band.status}`.trim() : 'no band'
      const value = m.status === 'SKIPPED' ? 'skipped' : m.value === null ? 'undefined' : `${m.value} ${m.unit}`.trim()
      this.lines.push({ run: dir, id: m.id, status: m.status, value, rule: band, ...(m.detail ? { note: m.detail } : {}) })
    }
    if (verdict.requirements)
      this.lines.push({ run: dir, id: 'required-metrics', status: verdict.requirements.passed ? 'PASS' : 'FAIL', value: verdict.requirements.metrics.join(', '), rule: 'every listed metric PASS (--require)' })
  }

  line(report: string, reportVersion: number | null, line: VerdictLine, trace: MotionTraceV1 | null): void {
    this.report = report
    this.reportVersion = reportVersion
    this.inputs.set(line.run, inputOf(line.run, trace))
    this.lines.push(line)
  }

  refuse(message: string): void {
    this.refusals.push(message)
  }

  get recorded(): boolean {
    return this.report !== null || this.refusals.length > 0
  }

  file(exitCode: number): VerdictFile {
    const verdict = exitCode === 0
      ? (this.lines.length && this.lines.every(line => line.status === 'REPORT') ? 'REPORT' : 'PASS')
      : exitCode === 1 ? 'FAIL' : 'REFUSED'
    return {
      kind: VERDICT_FILE_KIND,
      version: VERDICT_FILE_VERSION,
      command: this.command,
      report: this.report ?? this.command,
      reportVersion: this.reportVersion,
      verdict,
      exitCode,
      refusals: [...this.refusals],
      inputs: [...this.inputs.values()],
      lines: [...this.lines],
    }
  }

  /**
   * Writes the file and returns the exit code to use. A command that recorded nothing (it is not a report, or it
   * stopped on a usage error) writes a REFUSED file and exits 2, so a missing verdict is never read as a pass.
   */
  async finish(exitCode: number): Promise<number> {
    const code = this.recorded ? exitCode : 2
    if (!this.recorded) {
      const reason = exitCode === 2 ? 'the command stopped before it judged anything (exit 2)' : `qa:motion3d ${this.command} records no verdict lines; --json applies to gate and report commands`
      console.error(`qa:motion3d ${this.command}: ${reason}`)
      this.refusals.push(reason)
    }
    await writeFile(this.path, `${JSON.stringify(this.file(code), null, 2)}\n`)
    return code
  }
}
