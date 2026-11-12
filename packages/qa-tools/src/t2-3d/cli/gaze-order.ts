import type { Motion3dCliContext } from '../../../bin/motion3d'

import process from 'node:process'

import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { loadBands } from '../gate/load'
import { GateRefusal } from '../gate/refusals'
import { formatGazeOrderReport, GazeOrderRefusal, gazeOrderReport } from '../gaze-order'
import { MotionTraceRefusal, readTrace } from '../read-trace'

export async function gazeOrderMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  if (args.length !== 1 || args[0].startsWith('-')) {
    console.error('Usage: qa:motion3d gaze-order <run directory>')
    return 2
  }
  const dir = resolve(context.cwd, args[0])
  try {
    // The gaze class's committed detector parameters: its fitted floors and accepted head-rotation range.
    const gaze = (await loadBands(context.repoRoot)).classes.gaze
    if (!gaze)
      throw new GazeOrderRefusal('missing-floor', 'The frozen bands have no gaze class')
    const input = await readTrace(join(dir, 'trace.json'))
    const report = gazeOrderReport(input, gaze)
    await writeFile(join(dir, 'gaze-order.json'), `${JSON.stringify(report, null, 2)}\n`)
    const { share } = report.criterion
    context.verdicts?.line(report.kind, report.version, { run: dir, id: 'criterion-share', status: 'REPORT', value: `${share.ordered}/${share.total} = ${share.share?.toFixed(3) ?? '-'}`, rule: 'displacement order per gaze-shift of 10 deg or more; goal 2 needs 0.90; report only, judged by no exit code' }, input.trace)
    process.stdout.write(formatGazeOrderReport(report))
    return 0
  }
  catch (error) {
    if (!(error instanceof GazeOrderRefusal) && !(error instanceof MotionTraceRefusal) && !(error instanceof GateRefusal))
      throw error
    console.error(`qa:motion3d gaze-order ${dir}: ${error.name}: ${error.detail}`)
    context.verdicts?.refuse(`qa:motion3d gaze-order ${dir}: ${error.name}: ${error.detail}`)
    return 2
  }
}
