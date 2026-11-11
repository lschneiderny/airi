import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { MotionBandsFile } from '../gate/types'
import type { CriterionReport, LoadedRun } from '../reports/report'

import process from 'node:process'

import { resolve } from 'node:path'

import { loadBands } from '../gate/load'
import { GateRefusal } from '../gate/refusals'
import { MotionTraceRefusal } from '../read-trace'
import { loadRun, ReportUsageError, writeReport } from '../reports/report'

export interface ReportOutput {
  /** The run directory that receives `<name>.json` and `<name>.txt`. */
  readonly dir: string
  readonly report: CriterionReport<unknown>
  readonly text: string
}

/**
 * Shared lifecycle of the criterion-level report commands: load the frozen bands and every run directory, build,
 * write `<name>.json` and `<name>.txt` into each output directory, print the text, and exit 0 when every report
 * passes, 1 when one fails, 2 on a usage error or an unreadable input.
 */
export async function runReportCommand(name: string, usage: string, args: readonly string[], context: Motion3dCliContext, build: (runs: readonly LoadedRun[], bands: MotionBandsFile) => readonly ReportOutput[]): Promise<number> {
  const dirs = args.filter(arg => !arg.startsWith('-'))
  if (!dirs.length || dirs.length !== args.length) {
    console.error(`Usage: ${usage}`)
    return 2
  }
  try {
    const bands = await loadBands(context.repoRoot)
    const runs: LoadedRun[] = []
    for (const dir of dirs) {
      if (context.signal.aborted)
        return 130
      runs.push(await loadRun(resolve(context.cwd, dir)))
    }
    const outputs = build(runs, bands)
    for (const output of outputs) {
      await writeReport(output.dir, name, output.report, output.text)
      process.stdout.write(output.text)
    }
    return outputs.every(output => output.report.verdict === 'PASS') ? 0 : 1
  }
  catch (error) {
    if (!(error instanceof ReportUsageError) && !(error instanceof MotionTraceRefusal) && !(error instanceof GateRefusal))
      throw error
    console.error(`qa:motion3d ${name}: ${error.message}`)
    return 2
  }
}
