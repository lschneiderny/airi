import type { BodyActId } from '@proj-airi/motion-driver-humanoid/performance'

import type { Motion3dCliContext } from '../../../bin/motion3d'

import { ACT_KEYS, formatIdleActs, idleActsReport, isActId, REST_ACT_SET } from '../reports/idle-acts'
import { runReportCommand } from './report-cli'

const USAGE = 'qa:motion3d idle-acts <idle run directory> --pair <the same run with --acts off> [--rest-set <act id>,<act id>...]'

/**
 * `qa:motion3d idle-acts <run> --pair <acts-off run> [--rest-set ...]`: the C001 act report (plan R1, revision 2);
 * `--pair` names the same model, commit, seed and length run with acts switched off, `--rest-set` restricts the acts
 * allowed in rest.
 */
export async function idleActsMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  const option = (name: string) => {
    const at = args.indexOf(name)
    return at < 0 ? null : { at, value: args[at + 1] ?? '' }
  }
  const rest = option('--rest-set')
  const pair = option('--pair')
  const ids = rest ? rest.value.split(',') : []
  if (rest && (!ids.every(isActId) || !ids.length)) {
    console.error(`qa:motion3d idle-acts: --rest-set takes a comma-separated list of act ids from: ${Object.keys(ACT_KEYS).join(', ')}`)
    return 2
  }
  const restSet: readonly BodyActId[] = rest ? ids.filter(isActId) : REST_ACT_SET
  const taken = new Set([rest, pair].flatMap(o => o ? [o.at, o.at + 1] : []))
  const dirs = args.filter((_, i) => !taken.has(i))
  if (!pair || !pair.value || pair.value.startsWith('-') || dirs.length !== 1) {
    console.error(`Usage: ${USAGE}`)
    return 2
  }
  return runReportCommand('idle-acts', USAGE, [dirs[0], pair.value], context, ([run, companion]) => {
    const report = idleActsReport(run, companion, restSet)
    return [{ dir: run.dir, report, text: formatIdleActs(report) }]
  })
}
