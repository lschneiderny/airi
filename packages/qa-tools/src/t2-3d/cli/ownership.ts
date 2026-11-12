import type { Motion3dCliContext } from '../../../bin/motion3d'

import { formatOwnership, ownershipReport } from '../reports/ownership'
import { runReportCommand } from './report-cli'

/**
 * `qa:motion3d ownership <run>...`: the C004 report version 2 (plan 2.5, E/g3/own2/rules-v2.md) of the gated
 * `gesture-under-clip` runs of seeds 1 to 6, written into the first run. A refused pool prints every run and exits 2.
 */
export async function ownershipMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  let refused = false
  const code = await runReportCommand('ownership', 'qa:motion3d ownership <gesture-under-clip run directory>... (seeds 1 to 6)', args, context, (runs, bands) => {
    const report = ownershipReport(runs, bands)
    refused = report.detail.verdict === 'REFUSED'
    return [{ dir: runs[0].dir, report, text: formatOwnership(report) }]
  })
  return refused && code === 1 ? 2 : code
}
