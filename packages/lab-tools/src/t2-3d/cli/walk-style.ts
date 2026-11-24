import type { Motion3dCliContext } from '../../../bin/motion3d'

import process from 'node:process'

import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { MotionTraceRefusal } from '@proj-airi/qa-tools/t2-3d/read-trace'

import { loadRun, ReportUsageError } from '../reports/report'
import { formatWalkStyle, formatWalkStyleTable, WALK_STYLE_MEASURES, WALK_STYLE_VERSION, walkStyleReading } from '../reports/walk-style'

/**
 * `lab:motion3d report walk-style <run>...`: the walk style measures of each run beside the human range. It measures and
 * never judges, so it records no verdict. One run prints the long form; several print one row per run. Each run gets
 * `walk-style.json` and `walk-style.txt`. Exit 0 when every run was measured, 2 on a usage error or an unreadable run.
 */
export async function walkStyleMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  if (!args.length || args.some(arg => arg.startsWith('-'))) {
    console.error('Usage: lab:motion3d report walk-style <run directory>...')
    return 2
  }
  try {
    const readings = []
    for (const dir of args) {
      if (context.signal.aborted)
        return 130
      readings.push(walkStyleReading(await loadRun(resolve(context.cwd, dir))))
    }
    for (const reading of readings) {
      const text = formatWalkStyle(reading)
      await writeFile(join(reading.dir, 'walk-style.json'), `${JSON.stringify({ kind: 'walk-style', version: WALK_STYLE_VERSION, ranges: WALK_STYLE_MEASURES, ...reading }, null, 2)}\n`)
      await writeFile(join(reading.dir, 'walk-style.txt'), text)
      if (readings.length === 1)
        process.stdout.write(text)
    }
    if (readings.length > 1)
      process.stdout.write(formatWalkStyleTable(readings))
    return 0
  }
  catch (error) {
    if (!(error instanceof ReportUsageError) && !(error instanceof MotionTraceRefusal))
      throw error
    console.error(`lab:motion3d report walk-style: ${error.message}`)
    return 2
  }
}
