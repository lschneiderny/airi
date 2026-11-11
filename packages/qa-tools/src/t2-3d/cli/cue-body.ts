import type { Motion3dCliContext } from '../../../bin/motion3d'

import process from 'node:process'

import { cueBodyReport, cueFalsePositives, formatCueBody, formatCueFalsePositives } from '../reports/cue-body'
import { runReportCommand } from './report-cli'

const usage = 'qa:motion3d cue-body <emotions run directory>... | cue-body --calibrate <idle run directory>...'

/**
 * `qa:motion3d cue-body <run>...`: the C002 cue report (plan 2.3), written into the first run. `--calibrate` prints
 * the new pre-cue factor's false-positive share on idle runs instead and writes nothing.
 */
export async function cueBodyMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  if (args[0] === '--calibrate') {
    let below = true
    const code = await runReportCommand('cue-body', usage, args.slice(1), context, (runs, bands) => {
      const shares = cueFalsePositives(runs, bands)
      below = Object.values(shares).every(share => share.passing / share.total < 0.05)
      process.stdout.write(formatCueFalsePositives(shares))
      return []
    })
    return code === 0 && !below ? 1 : code
  }
  return runReportCommand('cue-body', usage, args, context, (runs, bands) => {
    const report = cueBodyReport(runs, bands)
    return [{ dir: runs[0].dir, report, text: formatCueBody(report) }]
  })
}
