import type { Motion3dCliContext } from '../../../bin/motion3d'

import { formatPops, popsReport } from '../reports/pops'
import { runReportCommand } from './report-cli'

/** `qa:motion3d pops <run>...`: one pops report per run directory (plan 2.6). */
export async function popsMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  return runReportCommand('pops', 'qa:motion3d pops <run directory>...', args, context, runs => runs.map((run) => {
    const report = popsReport(run)
    return { dir: run.dir, report, text: formatPops(report) }
  }))
}
