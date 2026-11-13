import type { Motion3dCliContext } from '../../../bin/motion3d'

import { formatGestureTiming, gestureTimingReport } from '../reports/gesture-timing'
import { runReportCommand } from './report-cli'

const usage = 'qa:motion3d gesture-timing <speak run directory>... --idle <companion idle run directory>...'

/**
 * `qa:motion3d gesture-timing <speak run>... --idle <idle run>...`: the C001 criterion report (plan 2.2) of each gated
 * speak run, its idle speed bar pooled over companion idle runs of the same model and commit (unit M3 item 1). Version 6
 * pools the trunk's locking and size over the speak runs given, which must be the speak seeds 1, 2 and 3.
 */
export async function gestureTimingMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  const split = args.indexOf('--idle')
  if (split < 1 || args.length < split + 2)
    return runReportCommand('gesture-timing', usage, [], context, () => [])
  return runReportCommand('gesture-timing', usage, [...args.slice(0, split), ...args.slice(split + 1)], context, (runs, bands) => {
    const speak = runs.slice(0, split)
    const idle = runs.slice(split)
    return speak.map((run) => {
      const report = gestureTimingReport(run, bands, idle, speak)
      return { dir: run.dir, report, text: formatGestureTiming(report) }
    })
  })
}
