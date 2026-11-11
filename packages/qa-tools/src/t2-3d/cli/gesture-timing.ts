import type { Motion3dCliContext } from '../../../bin/motion3d'

import { formatGestureTiming, gestureTimingReport } from '../reports/gesture-timing'
import { runReportCommand } from './report-cli'

/** `qa:motion3d gesture-timing <run>`: the C001 criterion report (plan 2.2) of one gated talk run. */
export async function gestureTimingMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  if (args.length !== 1)
    return runReportCommand('gesture-timing', 'qa:motion3d gesture-timing <run directory>', [], context, () => [])
  return runReportCommand('gesture-timing', 'qa:motion3d gesture-timing <run directory>', args, context, (runs, bands) => runs.map((run) => {
    const report = gestureTimingReport(run, bands)
    return { dir: run.dir, report, text: formatGestureTiming(report) }
  }))
}
