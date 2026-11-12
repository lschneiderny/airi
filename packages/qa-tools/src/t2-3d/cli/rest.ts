import type { Motion3dCliContext } from '../../../bin/motion3d'

import { formatRest, restReport } from '../reports/rest'
import { runReportCommand } from './report-cli'

/** `qa:motion3d rest <run>`: the C004 report (plan R3) of one sleepy-no-clip run. */
export async function restMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  return runReportCommand('rest', 'qa:motion3d rest <sleepy-no-clip run directory>', args.length === 1 ? args : [], context, (runs, bands) => runs.map((run) => {
    const report = restReport(run, bands)
    return { dir: run.dir, report, text: formatRest(report) }
  }))
}
