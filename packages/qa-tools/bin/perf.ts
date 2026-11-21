import process from 'node:process'

import { homedir } from 'node:os'

import { errorMessageFrom } from '@moeru/std'

import { benchHistoryPath, readBenchHistory } from '../src/bench/history'
import { parsePerfArgs, PERF_HELP, PerfUsageError } from '../src/perf/args'
import { compareBenchRefs, listBenchGroups } from '../src/perf/bench'
import { compareCommits, formatCommitComparison } from '../src/perf/compare'
import { defaultPerfDirs } from '../src/perf/dirs'
import { featureReports, formatFeatureReports, totalRollups, usageRollups } from '../src/perf/features'
import { formatBenchCompare, formatBenchGroups, formatIncident, formatIncidentList, formatSessions, formatSkipped, formatStatus } from '../src/perf/format'
import { listIncidents, readIncident } from '../src/perf/incident'
import { readPerfData } from '../src/perf/read'
import { summarizeSessions } from '../src/perf/sessions'
import { buildStatus, readStatusInputs } from '../src/perf/status'
import { readWorktreeState } from '../src/perf/worktree'
import { defaultGit } from '../src/track/accepted-costs'

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    // EPERM means the process exists but belongs to another user.
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

const print = (text: string) => process.stdout.write(`${text}\n`)
const note = (text: string | null) => text !== null && process.stderr.write(text.split('\n').map(line => `perf: ${line}\n`).join(''))

/** Usage rollups of the directories, each cell totalled over its buckets. */
async function compareRollups(dirs: readonly string[]) {
  const data = await readPerfData(dirs, { isPidAlive })
  note(formatSkipped(data.files))
  return totalRollups(usageRollups(data))
}

async function main(): Promise<number> {
  const cwd = process.env.INIT_CWD ?? process.cwd()
  const command = parsePerfArgs(process.argv.slice(2), cwd)
  if (command.kind === 'help') {
    print(PERF_HELP)
    return 0
  }
  const perfDirs = (dirs: readonly string[] | null) => dirs ?? defaultPerfDirs({ platform: process.platform, env: process.env, homedir: homedir() })
  const benchHistory = async () => {
    const history = await readBenchHistory(benchHistoryPath({ platform: process.platform, env: process.env, homedir: homedir() }))
    note(formatSkipped([history.counts]))
    return history
  }
  switch (command.kind) {
    case 'bench': {
      const history = await benchHistory()
      const groups = listBenchGroups(history.runs, { now: Date.now(), sinceMs: command.sinceMs, scenario: command.scenario })
      if (command.json)
        print(JSON.stringify(groups, null, 2))
      else
        print(groups.length > 0 ? formatBenchGroups(groups) : `no bench runs in ${history.counts.path}`)
      return 0
    }
    case 'compare-bench': {
      const history = await benchHistory()
      const local = command.a.kind === 'sha' && command.b.kind === 'sha' ? null : await readWorktreeState(cwd)
      const result = compareBenchRefs({ runs: history.runs, a: command.a, b: command.b, local, scenario: command.scenario, metric: command.metric })
      if (!result.ok) {
        note(`${result.message} (${history.counts.path})`)
        return 2
      }
      print(command.json ? JSON.stringify(result.scenarios, null, 2) : formatBenchCompare(result.scenarios))
      // A refused comparison is refused setup; any verdict, a regression included, is a completed comparison.
      return result.scenarios.some(scenario => scenario.status === 'refused') ? 2 : 0
    }
    case 'sessions': {
      const dirs = perfDirs(command.dirs)
      const data = await readPerfData(dirs, { isPidAlive })
      const sessions = summarizeSessions(data, { now: Date.now(), sinceMs: command.sinceMs })
      note(formatSkipped(data.files))
      if (command.json)
        print(JSON.stringify(sessions, null, 2))
      else
        print(sessions.length > 0 ? formatSessions(sessions) : `no perf data in ${dirs.join(', ')}`)
      return 0
    }
    case 'incident-list': {
      const dirs = perfDirs(command.dirs)
      const { incidents, files } = await listIncidents(dirs)
      note(formatSkipped(files))
      if (command.json)
        print(JSON.stringify(incidents, null, 2))
      else
        print(incidents.length > 0 ? formatIncidentList(incidents) : `no incidents in ${dirs.join(', ')}`)
      return 0
    }
    case 'incident': {
      const dirs = perfDirs(command.dirs)
      const found = await readIncident(dirs, command.id)
      if (found === null) {
        note(`unknown incident id "${command.id}" in ${dirs.join(', ')}`)
        return 2
      }
      print(command.json ? JSON.stringify({ path: found.path, ...found.file }, null, 2) : formatIncident(found.path, found.file))
      return 0
    }
    case 'features': {
      const reports = featureReports(await compareRollups(perfDirs(command.dirs)), command)
      print(command.json ? JSON.stringify({ label: 'observational', reports }, null, 2) : formatFeatureReports(reports))
      return 0
    }
    case 'compare': {
      const report = compareCommits(await compareRollups(perfDirs(command.dirs)), command)
      print(command.json ? JSON.stringify(report, null, 2) : formatCommitComparison(report, { a: command.shaA, b: command.shaB }))
      return 0
    }
    case 'status': {
      const git = defaultGit(cwd)
      const repoRoot = (await git(['rev-parse', '--show-toplevel'])).trim()
      const { inputs, counts } = await readStatusInputs({ platform: process.platform, env: process.env, homedir: homedir() }, repoRoot, git)
      note(formatSkipped(counts))
      const status = buildStatus({ ...inputs, now: Date.now() })
      print(command.json ? JSON.stringify(status, null, 2) : formatStatus(status))
      return 0
    }
    default: {
      const unhandled: never = command
      return unhandled
    }
  }
}

main().then((code) => {
  process.exitCode = code
}, (error) => {
  if (error instanceof PerfUsageError) {
    process.stderr.write(`perf: ${error.message}\n`)
    process.exitCode = 2
    return
  }
  process.stderr.write(`perf: ${errorMessageFrom(error) ?? 'failed'}\n`)
  process.exitCode = 1
})
