import type { BodyActId } from '@proj-airi/motion-driver-humanoid/performance'

import type { Motion3dCliContext } from '../../../bin/motion3d'

import { ACT_REGIONS, formatIdleActs, idleActsReport, isActId, REST_ACT_SET } from '../reports/idle-acts'
import { runReportCommand } from './report-cli'

const USAGE = 'qa:motion3d idle-acts <idle run directory> [--rest-set <act id>,<act id>...]'

/** `qa:motion3d idle-acts <run> [--rest-set ...]`: the C001 act report (plan R1); `--rest-set` restricts the acts allowed in rest. */
export async function idleActsMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  const at = args.indexOf('--rest-set')
  const ids = at < 0 ? [] : (args[at + 1] ?? '').split(',')
  if (at >= 0 && (!ids.every(isActId) || !ids.length)) {
    console.error(`qa:motion3d idle-acts: --rest-set takes a comma-separated list of act ids from: ${Object.keys(ACT_REGIONS).join(', ')}`)
    return 2
  }
  const restSet: readonly BodyActId[] = at < 0 ? REST_ACT_SET : ids.filter(isActId)
  const dirs = at < 0 ? args : [...args.slice(0, at), ...args.slice(at + 2)]
  return runReportCommand('idle-acts', USAGE, dirs.length === 1 ? dirs : [], context, runs => runs.map((run) => {
    const report = idleActsReport(run, restSet)
    return { dir: run.dir, report, text: formatIdleActs(report) }
  }))
}
