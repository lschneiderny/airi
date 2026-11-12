import type { Motion3dCliContext } from '../../../bin/motion3d'

import { formatWalkForm, walkFormReport } from '../reports/walk-form'
import { runReportCommand } from './report-cli'

/** `qa:motion3d walk-form <run>`: the C002 and C003 walk report (plan R2) of one walk-class run with its summary. */
export async function walkFormMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  return runReportCommand('walk-form', 'qa:motion3d walk-form <walk run directory>', args.length === 1 ? args : [], context, runs => runs.map((run) => {
    const report = walkFormReport(run)
    return { dir: run.dir, report, text: formatWalkForm(report) }
  }))
}
