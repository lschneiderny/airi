import type { Motion3dCliContext } from '../../../bin/motion3d'

import { emotionTableReport, formatEmotionTable } from '../reports/emotion-table'
import { runReportCommand } from './report-cli'

/** `qa:motion3d emotion-table <run>...`: the C002 pooled emotion table (plan 2.3), written into the first run. */
export async function emotionTableMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  return runReportCommand('emotion-table', 'qa:motion3d emotion-table <emotions run directory>...', args, context, (runs, bands) => {
    const report = emotionTableReport(runs, bands)
    return [{ dir: runs[0].dir, report, text: formatEmotionTable(report) }]
  })
}
