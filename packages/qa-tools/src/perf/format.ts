import type { BenchCodeState, BenchGroupRow, BenchScenarioComparison, BenchSide } from './bench'
import type { IncidentEntry, IncidentFile } from './incident'
import type { PerfFileCounts } from './read'
import type { SessionSummary } from './sessions'

/** `<short sha>`, then `*` when any epoch was dirty and `~<n>` when the identity changed during the session. */
export function formatShaLabel(identity: Pick<SessionSummary, 'shortSha' | 'dirty' | 'epochs'>): string {
  if (identity.shortSha === null)
    return '-'
  return `${identity.shortSha}${identity.dirty ? '*' : ''}${identity.epochs > 1 ? `~${identity.epochs}` : ''}`
}

const formatTime = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
const formatPercent = (share: number | null) => (share === null ? '-' : `${(share * 100).toFixed(1)}%`)
const formatNumber = (value: number | null, digits: number) => (value === null ? '-' : value.toFixed(digits))

function formatDuration(ms: number | null): string {
  if (ms === null)
    return '-'
  const minutes = Math.floor(ms / 60_000)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}s`
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map(row => row[column].length)))
  return [header, ...rows].map(row => row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()).join('\n')
}

export function formatSessions(sessions: readonly SessionSummary[]): string {
  return table(
    ['START (UTC)', 'DURATION', 'SHA', 'HOST', 'RENDERER/MODEL', 'FPS', '>=36MS', '>=100MS', 'CPU%', 'MAX WS MB', 'INCIDENTS', 'FLAGS', 'SESSION'],
    sessions.map(session => [
      session.startedAt === null ? '-' : formatTime(session.startedAt),
      formatDuration(session.durationMs),
      formatShaLabel(session),
      session.host ?? '-',
      session.renderer === null ? '-' : `${session.renderer}/${session.modelName ?? session.modelId ?? '-'}`,
      formatNumber(session.fps, 1),
      formatPercent(session.share36),
      formatPercent(session.share100),
      formatNumber(session.stageCpuPct, 1),
      formatNumber(session.maxWorkingSetKb === null ? null : session.maxWorkingSetKb / 1024, 0),
      String(session.incidents),
      [session.live ? 'live' : '', session.recovered ? 'recovered' : '', session.failedSegments > 0 ? `failed:${session.failedSegments}` : ''].filter(Boolean).join(',') || '-',
      session.sessionId,
    ]),
  )
}

export function formatIncidentList(incidents: readonly IncidentEntry[]): string {
  return table(
    ['TIME (UTC)', 'TRIGGER', 'WINDOW', 'PID', 'HOST CONTENDED', 'RING', 'ID'],
    incidents.map(incident => [
      formatTime(incident.t),
      incident.trigger,
      incident.window ?? '-',
      incident.pid === null ? '-' : String(incident.pid),
      incident.hostContended ? 'yes' : 'no',
      incident.ringMissing ? 'missing' : 'yes',
      incident.id,
    ]),
  )
}

export function formatIncident(path: string, file: IncidentFile): string {
  const { incident } = file
  return [
    `id: ${incident.id}`,
    `session: ${incident.sessionId}`,
    `time: ${new Date(incident.t).toISOString()}`,
    `trigger: ${incident.trigger}`,
    `window: ${incident.window ?? '-'}`,
    `pid: ${incident.pid ?? '-'}`,
    `peak: ${Object.entries(incident.peak).map(([name, value]) => `${name}=${value}`).join(', ') || '-'}`,
    `host contended: ${incident.hostContended ? 'yes' : 'no'}`,
    `frame ring: ${file.ringMissing ? 'missing' : 'captured'}`,
    `recent lines: ${file.recent.length}`,
    `file: ${path}`,
  ].join('\n')
}

/** `<9-digit sha>`, then `*<diff hash prefix>` for a dirty tree. */
const formatCodeState = (state: BenchCodeState) => `${state.sha.slice(0, 9)}${state.diffHash === null ? '' : `*${state.diffHash.slice(0, 8)}`}`

export function formatBenchGroups(rows: readonly BenchGroupRow[]): string {
  return table(
    ['SCENARIO', 'SHA', 'VALID/RUNS', 'LAST (UTC)', 'FPS', 'P95 MS', 'CPU%', 'CPU MS/FRAME', 'WS MB'],
    rows.map(row => [
      row.scenario,
      formatCodeState(row),
      `${row.validRuns}/${row.runs}`,
      formatTime(row.lastT),
      formatNumber(row.medians.fps, 1),
      formatNumber(row.medians.p95FrameMsApprox, 2),
      formatNumber(row.medians.stageWindowCpuPct, 1),
      formatNumber(row.medians.stageWindowCpuMsPerFrame, 2),
      formatNumber(row.medians.stageWindowWorkingSetKb === null ? null : row.medians.stageWindowWorkingSetKb / 1024, 0),
    ]),
  )
}

const formatSide = (side: BenchSide) => `${side.ref} (${formatCodeState(side.group)})`
const formatValues = (values: readonly { readonly run: number, readonly value: number }[]) => values.map(entry => `${entry.run}=${entry.value.toFixed(2)}`).join(' ')

/** Every run value, the medians, sigma, practical floor, agreement, verdict, confidence and staleness, or the refusals. */
export function formatBenchCompare(scenarios: readonly BenchScenarioComparison[]): string {
  return scenarios.flatMap((scenario) => {
    const lines = [`${scenario.scenario}: A ${formatSide(scenario.a)} vs B ${formatSide(scenario.b)}`]
    for (const [label, side] of [['A', scenario.a], ['B', scenario.b]] as const) {
      if (side.excluded.length > 0)
        lines.push(`  ${label} excluded invalid runs: ${side.excluded.map(entry => `${entry.run} (${entry.invalidReason})`).join(', ')}`)
    }
    if (scenario.status === 'refused')
      return [...lines, '  refused:', ...scenario.refusals.map(refusal => `    ${refusal.reason}: ${refusal.detail}`)]
    for (const result of scenario.comparisons) {
      lines.push(
        `  ${result.metric}: ${result.verdict}`,
        `    A runs: ${formatValues(result.valuesA)}`,
        `    B runs: ${formatValues(result.valuesB)}`,
        `    median A ${result.medianA.toFixed(2)}, B ${result.medianB.toFixed(2)}, difference ${result.difference >= 0 ? '+' : ''}${result.difference.toFixed(2)}`,
        `    sigma ${result.sigma.toFixed(3)} (${result.noise}, ${result.historyCommits} history commits), floor ${result.practicalFloor}, agreement ${result.agreement.count} of ${result.agreement.of} (needs ${result.agreement.required})`,
        `    lowConfidence ${result.lowConfidence}, stale ${result.stale}`,
      )
    }
    return lines
  }).join('\n')
}

/** One line per file with rejected lines, or `null` when every line parsed. */
export function formatSkipped(files: readonly PerfFileCounts[]): string | null {
  const skipped = files.filter(file => file.malformed + file.unknownVersion > 0)
  if (skipped.length === 0)
    return null
  return skipped.map(file => `skipped ${file.malformed} malformed and ${file.unknownVersion} unknown-version lines in ${file.path}`).join('\n')
}
