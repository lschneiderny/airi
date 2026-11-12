import type { Motion3dCliContext } from '../../../bin/motion3d'

import { formatOwnership, ownershipReport } from '../reports/ownership'
import { runReportCommand } from './report-cli'

const usage = 'qa:motion3d ownership <gesture-under-clip run directory>... (seeds 1 to 6) --idle <idle run of at most 60 s scored>... (seeds 1 to 6)'

/**
 * `qa:motion3d ownership <run>... --idle <idle run>...`: the C004 report version 2 (plan 2.5, E/g3/own2/rules-v2.md,
 * revision C2.1) of the gated `gesture-under-clip` runs of seeds 1 to 6, written into the first run. Its stroke bar is
 * gesture-timing's, pooled over short companion idle runs of the same model and commit (one rest each); without them,
 * with an idle run long enough to redraw its rest, or with a refused pool, it prints every run and exits 2.
 */
export async function ownershipMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  const split = args.indexOf('--idle')
  const runs = split < 0 ? args : args.slice(0, split)
  const idle = split < 0 ? [] : args.slice(split + 1)
  if (split >= 0 && !idle.length)
    return runReportCommand('ownership', usage, [], context, () => [])
  let refused = false
  const code = await runReportCommand('ownership', usage, [...runs, ...idle], context, (loaded) => {
    const report = ownershipReport(loaded.slice(0, runs.length), loaded.slice(runs.length))
    refused = report.detail.verdict === 'REFUSED'
    return [{ dir: loaded[0].dir, report, text: formatOwnership(report) }]
  })
  return refused && code === 1 ? 2 : code
}
