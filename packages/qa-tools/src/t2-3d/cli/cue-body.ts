import type { Motion3dCliContext } from '../../../bin/motion3d'

import process from 'node:process'

import { CUE_FALSE_POSITIVE_LIMIT, cueBodyReport, cueFalsePositives, formatCueBody, formatCueFalsePositives } from '../reports/cue-body'
import { runReportCommand } from './report-cli'

const usage = 'qa:motion3d cue-body <emotions run directory>... | cue-body --calibrate <run directory>...'

/**
 * `qa:motion3d cue-body <run>...`: the C002 cue report (unit M2 R3), written into the first run. `--calibrate` prints
 * the split-half placebo false-positive share per cue kind instead, writes nothing, and exits 1 above 10 %.
 */
export async function cueBodyMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  if (args[0] === '--calibrate') {
    let within = true
    const code = await runReportCommand('cue-body', usage, args.slice(1), context, (runs) => {
      const shares = cueFalsePositives(runs)
      within = Object.values(shares).every(share => share.total > 0 && share.flagged / share.total <= CUE_FALSE_POSITIVE_LIMIT)
      process.stdout.write(formatCueFalsePositives(shares))
      return []
    })
    return code === 0 && !within ? 1 : code
  }
  return runReportCommand('cue-body', usage, args, context, (runs) => {
    const report = cueBodyReport(runs)
    return [{ dir: runs[0].dir, report, text: formatCueBody(report) }]
  })
}
