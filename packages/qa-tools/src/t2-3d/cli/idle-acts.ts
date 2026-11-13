import type { Motion3dCliContext } from '../../../bin/motion3d'

import { formatIdleActs, idleActsReport } from '../reports/idle-acts'
import { runReportCommand } from './report-cli'

const USAGE = 'qa:motion3d idle-acts <idle run directory> --pair <the same run with --acts off>'

/**
 * `qa:motion3d idle-acts <run> --pair <acts-off run>`: the C001 act report (version 5, goal 4 unit M2); `--pair` names
 * the same model, commit, scenario, seed and length run with acts switched off (no idle drive).
 */
export async function idleActsMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  const at = args.indexOf('--pair')
  const pair = at < 0 ? '' : args[at + 1] ?? ''
  const dirs = args.filter((_, i) => at < 0 || (i !== at && i !== at + 1))
  if (!pair || pair.startsWith('-') || dirs.length !== 1) {
    console.error(`Usage: ${USAGE}`)
    return 2
  }
  return runReportCommand('idle-acts', USAGE, [dirs[0], pair], context, ([run, companion]) => {
    const report = idleActsReport(run, companion)
    return [{ dir: run.dir, report, text: formatIdleActs(report) }]
  })
}
