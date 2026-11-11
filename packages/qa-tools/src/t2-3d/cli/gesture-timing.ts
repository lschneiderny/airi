import type { Motion3dCliContext } from '../../../bin/motion3d'

import { formatGestureTiming, gestureTimingReport } from '../reports/gesture-timing'
import { runReportCommand } from './report-cli'

const usage = 'qa:motion3d gesture-timing <run directory> --idle <companion idle run directory>...'

/**
 * `qa:motion3d gesture-timing <run> --idle <idle run>...`: the C001 criterion report (plan 2.2) of one gated talk run,
 * its idle speed bar pooled over companion idle runs of the same model and commit (unit M3 item 1).
 */
export async function gestureTimingMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  const split = args.indexOf('--idle')
  if (split !== 1 || args.length < 3)
    return runReportCommand('gesture-timing', usage, [], context, () => [])
  return runReportCommand('gesture-timing', usage, [args[0], ...args.slice(2)], context, (runs, bands) => {
    const report = gestureTimingReport(runs[0], bands, runs.slice(1))
    return [{ dir: runs[0].dir, report, text: formatGestureTiming(report) }]
  })
}
