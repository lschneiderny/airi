import type { Motion3dCliContext } from '../../../bin/motion3d'

import process from 'node:process'

import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { formatGazeOrderReport, GazeOrderRefusal, gazeOrderReport } from '../gaze-order'
import { MotionTraceRefusal, readTrace } from '../read-trace'

export async function gazeOrderMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  if (args.length !== 1 || args[0].startsWith('-')) {
    console.error('Usage: qa:motion3d gaze-order <run directory>')
    return 2
  }
  const dir = resolve(context.cwd, args[0])
  try {
    const report = gazeOrderReport(await readTrace(join(dir, 'trace.json')))
    await writeFile(join(dir, 'gaze-order.json'), `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(formatGazeOrderReport(report))
    return 0
  }
  catch (error) {
    if (!(error instanceof GazeOrderRefusal) && !(error instanceof MotionTraceRefusal))
      throw error
    console.error(`qa:motion3d gaze-order ${dir}: ${error.name}: ${error.detail}`)
    return 2
  }
}
