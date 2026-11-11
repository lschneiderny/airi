import type { Motion3dCliContext } from '../../../bin/motion3d'

import { formatOwnership, ownershipReport } from '../reports/ownership'
import { runReportCommand } from './report-cli'

/** `qa:motion3d ownership <run>`: the C004 report (plan 2.5) of one gated `gesture-under-clip` run. */
export async function ownershipMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  return runReportCommand('ownership', 'qa:motion3d ownership <gesture-under-clip run directory>', args.length === 1 ? args : [], context, (runs, bands) => runs.map((run) => {
    const report = ownershipReport(run, bands)
    return { dir: run.dir, report, text: formatOwnership(report) }
  }))
}
