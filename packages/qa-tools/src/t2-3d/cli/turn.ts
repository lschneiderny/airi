import type { Motion3dCliContext } from '../../../bin/motion3d'

import { formatTurn, turnReport } from '../reports/turn'
import { runReportCommand } from './report-cli'

/** `qa:motion3d turn <capture>`: the C003 report (plan 2.4) of one gated talk-class rendered capture. */
export async function turnMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  return runReportCommand('turn', 'qa:motion3d turn <capture directory>', args.length === 1 ? args : [], context, runs => runs.map((run) => {
    const report = turnReport(run)
    return { dir: run.dir, report, text: formatTurn(report) }
  }))
}
