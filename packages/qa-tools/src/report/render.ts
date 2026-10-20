import type { GateReport } from '../motion/gate/report'
import type { EmotionCell, MalformedResult, VisualCheckItem } from './cells'
import type { RunInput, ScenarioEvent, ScreenshotInput, T3Facet } from './inputs'

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { emotionCells, visualCheckItems, visualRangeShare, visualSizeRatio } from './cells'
import { escapeHtml, formatNumber, formatPair, pngDataUrl, shortSha } from './html-utils'
import { loadRunInput, rigFromEnv } from './inputs'
import { reportLimitations } from './limitations'
import { reportStyles } from './styles'
import { cellTrajectorySvg } from './trajectory-svg'

export interface RenderedReport {
  html: string
  inputs: RunInput[]
  /** Every issue of every input; a non-empty list means the page names missing or corrupt inputs. */
  issues: { run: string, file: string, problem: string }[]
  /** Cells (emotion x band) listed under "For your visual check", by key. */
  visualCheck: string[]
}

export interface RenderOptions {
  runDirs: readonly string[]
  /** Injectable for tests; defaults to the current time. */
  now?: () => Date
}

interface GateView {
  run: RunInput
  report: GateReport
  cells: EmotionCell[]
  malformed: MalformedResult[]
}

const section = (id: string, title: string, body: string) => `<section id="${id}"><h2>${escapeHtml(title)}</h2>${body}</section>`
const badge = (verdict: string) => `<span class="badge ${verdict === 'pass' ? 'pass' : verdict === 'fail' ? 'fail' : 'na'}">${escapeHtml(verdict)}</span>`

function unreadableRows(view: GateView): string {
  if (view.malformed.length === 0)
    return ''
  return `<div class="callout fail"><p><strong>${view.malformed.length} result row${view.malformed.length === 1 ? '' : 's'} could not be read</strong> and ${view.malformed.length === 1 ? 'is' : 'are'} missing from the table below.</p><ul class="plain">${view.malformed.map(row => `<li><span class="mono">${escapeHtml(row.key)}</span> ${badge(row.verdict)}: ${escapeHtml(row.problem)}</li>`).join('')}</ul></div>`
}

// --- Header ------------------------------------------------------------------------------------

function levelOf(run: RunInput): string {
  const levels: string[] = []
  if (run.gate)
    levels.push(run.gate.report.level)
  if (run.t3)
    levels.push('t3')
  if (run.test)
    levels.push('qa:test')
  return levels.join(', ') || '—'
}

function headerSection(inputs: readonly RunInput[], now: Date): string {
  const cards = inputs.map((run) => {
    const manifest = run.manifest
    const gate = run.gate?.report
    const rig = run.t3?.rig ?? rigFromEnv(manifest)
    const rows: [string, string][] = [
      ['run id', manifest?.runId ?? run.name],
      ['level', levelOf(run)],
      ['rig', rig ?? '—'],
      ['git', manifest ? `${shortSha(manifest.gitSha)}${manifest.dirty ? ' (dirty)' : ' (clean)'}` : '—'],
      ['gate', gate ? `${gate.gateId} v${gate.version} file ${shortSha(gate.fileSha)}` : manifest?.gate ? `${manifest.gate.id} v${manifest.gate.version} file ${shortSha(manifest.gate.fileSha)}` : '—'],
      ['result', manifest ? `exit ${manifest.result.exitCode}: ${manifest.result.summary}` : '—'],
      ['directory', run.dir],
    ]
    return `<div class="card"><dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd class="${k === 'directory' || k === 'git' ? 'mono xs' : ''}">${escapeHtml(v)}</dd>`).join('')}</dl></div>`
  })
  return `<header><h1>Motion QA review report</h1><p class="lede">Generated ${escapeHtml(now.toISOString())} from ${inputs.length} run director${inputs.length === 1 ? 'y' : 'ies'}. Self-contained: no fonts, scripts or images are loaded from a URL.</p><div class="meta">${cards.join('')}</div></header>`
}

function limitationsSection(): string {
  return `<section id="limitations"><div class="callout"><p><strong>What these scores mean.</strong> ${escapeHtml(reportLimitations)}</p></div></section>`
}

// --- Verdict table ----------------------------------------------------------------------------

function channelDetails(cell: EmotionCell): string {
  const hasTransfer = cell.channels.some(row => typeof row.result.transferRatio === 'number')
  const head = ['channel', 'verdict', 'n', 'E', '95% CI', 'expected', 'size ratio', 'd', 'hit rate', 'p (Holm)', 'tau', ...(hasTransfer ? ['transfer E_T3/E_T1'] : []), 'peak level [min, max]', 'failed', 'reasons']
  const rows = cell.channels.map(({ result, levels }) => {
    const cells = [
      `<td class="mono">${escapeHtml(result.channel)}${result.unsigned ? ' <span class="badge note">unsigned</span>' : ''}</td>`,
      `<td>${badge(result.verdict)}</td>`,
      `<td class="num">${result.n ?? '—'}</td>`,
      `<td class="num">${formatNumber(result.E)}</td>`,
      `<td class="num">${formatPair(result.ci)}</td>`,
      `<td class="num">${formatNumber(result.expected)}</td>`,
      `<td class="num">${formatNumber(result.sizeRatio)}</td>`,
      `<td class="num">${formatNumber(result.d)}</td>`,
      `<td class="num">${formatNumber(result.hitRate, 2)}</td>`,
      `<td class="num">${formatNumber(result.pHolm, 2)}</td>`,
      `<td class="num">${formatNumber(result.tau)}${result.tauCi ? ` ${formatPair(result.tauCi, 2)}` : ''}</td>`,
      ...(hasTransfer ? [`<td class="num">${formatNumber(result.transferRatio)}</td>`] : []),
      `<td class="wrap">${levels?.length ? levels.map(level => `<span class="mono">${escapeHtml(level.id)}</span> ${formatNumber(level.baseline, 2)} → ${formatNumber(level.peak, 2)} [${formatNumber(level.min, 2)}, ${formatNumber(level.max, 2)}]`).join('<br>') : '—'}</td>`,
      `<td>${escapeHtml((result.failed ?? []).join(', ') || '—')}</td>`,
      `<td class="wrap">${escapeHtml((result.reasons ?? []).join('; ') || '—')}</td>`,
    ]
    return `<tr>${cells.join('')}</tr>`
  })
  return `<details class="channels"><summary>${cell.channels.length} channels</summary><div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div></details>`
}

function verdictTable(view: GateView): string {
  const rows = view.cells.map((cell) => {
    const failing = cell.channels.filter(row => row.result.verdict !== 'pass')
    const tally = `${cell.channels.length - failing.length} pass, ${failing.filter(r => r.result.verdict === 'fail').length} fail, ${failing.filter(r => r.result.verdict === 'n/a').length} n/a`
    const failed = failing.map(row => `${row.result.channel}: ${(row.result.failed ?? []).join(', ') || row.result.verdict}`).join('; ')
    return `<tr id="verdict-${escapeHtml(cell.key.replace(':', '-'))}"><td class="mono">${escapeHtml(cell.emotion)}</td><td>${escapeHtml(cell.band)}</td><td>${badge(cell.verdict)}</td><td>${escapeHtml(tally)}</td><td class="wrap">${escapeHtml(failed || '—')}</td><td class="wrap">${channelDetails(cell)}</td></tr>`
  })
  return `<div class="table-wrap"><table><thead><tr><th>emotion</th><th>band</th><th>verdict</th><th>checks</th><th class="wrap">failed checks</th><th class="wrap">per-channel details</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
}

function livelinessTable(report: GateReport): string {
  const rows = report.results.map((result) => {
    const value = typeof result.value === 'number' ? formatNumber(result.value) : '—'
    const band = isPair(result.band) ? formatPair(result.band) : '—'
    return `<tr><td class="mono">${escapeHtml(result.key)}</td><td>${badge(result.verdict)}</td><td class="num">${value}</td><td class="num">${band}</td></tr>`
  })
  return `<div class="table-wrap"><table><thead><tr><th>metric</th><th>verdict</th><th>value</th><th>reference band</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
}

function isPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'number')
}

function verdictSection(views: readonly GateView[]): string {
  const blocks = views.map((view) => {
    const { report } = view
    const head = `<h3>${escapeHtml(`${report.gateId} v${report.version}`)} (${escapeHtml(report.level)}) ${badge(report.pass ? 'pass' : 'fail')}</h3><p class="small muted">Gate limitation as recorded: ${escapeHtml(report.limitation)}</p>`
    const body = view.cells.length > 0 ? verdictTable(view) : livelinessTable(report)
    return `<div class="gate">${head}${unreadableRows(view)}${body}</div>`
  })
  return section('verdicts', 'Verdicts', blocks.join(''))
}

// --- Trajectories -----------------------------------------------------------------------------

function trajectorySection(views: readonly GateView[]): string {
  const blocks = views.filter(view => view.cells.length > 0).map((view) => {
    const withTrajectory = view.cells.flatMap(cell => cell.channels).filter(row => row.trajectory !== null).length
    const withRelease = view.cells.flatMap(cell => cell.channels).filter(row => row.release !== null).length
    const note = [
      withTrajectory > 0
        ? `The paired mean trajectory (emotion run minus the stripped run with the same seed, both relative to their baseline, direction-folded like E) comes from <code>report.json</code> (schema ${view.report.reportSchema ?? 1}) on a 0.1 s grid with a seeded 200-resample bootstrap band; ${withTrajectory} of ${view.cells.flatMap(cell => cell.channels).length} channel panels have one (modulation channels have no sample trajectory).`
        : `This <code>report.json</code> (schema ${view.report.reportSchema ?? 1}) carries no paired trajectories, so only its window statistics are drawn: the paired mean effect with its bootstrap CI over the scored window, the late-window mean with its CI, and the expected effect.`,
      withRelease > 0 ? `${withRelease} face and posture panels also show the held-only trials' 30 Hz release grids from <code>partials/</code>.` : '',
      `Each panel's y axis is in the units its E is scored in (named in the gutter): half-range units for face and posture, log ratios for the eyelid and the modulation channels. A mark is drawn only in its panel's units, so eyelid panels carry no late-window mean, late CI or release grid: the scorer computes those from lid ratios minus one.`,
    ].join(' ')
    const cells = view.cells.map(cell => `<div class="card" id="traj-${escapeHtml(cell.key.replace(':', '-'))}"><div class="cell-head"><h3>${escapeHtml(cell.emotion)} <span class="muted">${escapeHtml(cell.band)}</span></h3>${badge(cell.verdict)}</div>${cellTrajectorySvg(cell)}</div>`)
    return `<h3>${escapeHtml(`${view.report.gateId} v${view.report.version}`)}</h3><p class="small muted">${note} Time is seconds after the pulse; the gray band is the placebo null q90 of each channel; shaded columns are the gate's windows (baseline, scored, release fit, late).</p><div class="legend"><span class="l-effect">E over the scored window</span><span class="l-ci">bootstrap 95% CI</span><span class="l-expected">expected effect</span><span class="l-null">null q90 band</span><span class="l-late">late-window mean</span><span class="l-traj">paired mean trajectory + band</span><span class="l-release">held-only release grid (partials)</span></div><div class="cells">${cells.join('')}</div>`
  })
  return blocks.length ? section('trajectories', 'Per-cell trajectories', blocks.join('')) : ''
}

// --- T3 contact sheet -------------------------------------------------------------------------

function eventLabel(event: ScenarioEvent): string {
  if (event.kind === 'emotion')
    return `${event.emotion ?? '?'} ${event.band ?? ''}`.trim()
  if (event.kind === 'act')
    return `act ${event.marker ?? ''}`.trim()
  if (event.kind === 'expression')
    return `expression ${event.expressionId ?? '?'} ${event.on ? 'on' : 'off'}`
  return event.kind
}

function groupByPulse(t3: T3Facet): { label: string, at: number | null, shots: ScreenshotInput[] }[] {
  const pulses = [...t3.scenario.events].sort((a, b) => a.at - b.at)
  const groups = pulses.map(event => ({ label: eventLabel(event), at: event.at as number | null, shots: [] as ScreenshotInput[] }))
  const before = { label: 'before the first event', at: null as number | null, shots: [] as ScreenshotInput[] }
  for (const shot of [...t3.screenshots].sort((a, b) => a.at - b.at)) {
    let owner = -1
    for (let index = 0; index < pulses.length; index++) {
      if (pulses[index].at <= shot.at)
        owner = index
    }
    (owner === -1 ? before : groups[owner]).shots.push(shot)
  }
  return [before, ...groups].filter(group => group.shots.length > 0)
}

function contactSheet(run: RunInput, t3: T3Facet): string {
  const groups = groupByPulse(t3)
  const blocks = groups.map((group) => {
    const figures = group.shots.map((shot) => {
      const offset = group.at === null ? `t = ${shot.at.toFixed(1)} s` : `+${(shot.at - group.at).toFixed(1)} s after the pulse (t = ${shot.at.toFixed(1)} s${typeof shot.actualAt === 'number' ? `, taken at ${shot.actualAt.toFixed(2)} s` : ''})`
      const image = shot.png ? `<img src="${pngDataUrl(shot.png)}" alt="${escapeHtml(`${group.label} ${offset}`)}" loading="lazy">` : `<div class="shot-missing muted xs">screenshot missing: ${escapeHtml(shot.file)}</div>`
      return `<figure class="shot">${image}<figcaption><span class="mono">${escapeHtml(shot.file)}</span><br>${escapeHtml(offset)}</figcaption></figure>`
    })
    return `<div class="pulse"><h3>${escapeHtml(group.label)}${group.at !== null ? ` <span class="muted small">at ${group.at} s</span>` : ''}</h3><div class="sheet">${figures.join('')}</div></div>`
  })
  const verification = t3.verification ? `Verification: ${t3.verification.ok ? 'ok' : `failed (${t3.verification.failures.join('; ')})`}.` : 'No verification.json.'
  const watermark = t3.rig === 'forbooth' ? `<div class="callout warn"><p><strong>Note on the screenshots.</strong> ForBOOTH's default watermark expression covers most of the face in every capture. The screenshots are shown as taken; posture, hair and body motion remain readable, the face largely does not.</p></div>` : ''
  return `<h3>${escapeHtml(run.manifest?.runId ?? run.name)} <span class="muted small">scenario ${escapeHtml(t3.scenario.id)}, ${t3.scenario.durationSeconds} s, rig ${escapeHtml(t3.rig ?? '—')}</span></h3><p class="small muted">${escapeHtml(verification)} ${t3.screenshots.length} screenshots grouped by the scenario event that precedes them.</p>${watermark}${blocks.join('')}`
}

function t3Section(inputs: readonly RunInput[]): string {
  const blocks: string[] = []
  for (const run of inputs) {
    if (run.t3)
      blocks.push(contactSheet(run, run.t3))
  }
  return blocks.length ? section('t3', 'T3 rendered runs', blocks.join('')) : ''
}

// --- For your visual check --------------------------------------------------------------------

function visualSection(views: readonly GateView[]): { html: string, keys: string[] } {
  const items: VisualCheckItem[] = views.flatMap(view => visualCheckItems(view.cells, view.malformed))
  const keys = items.map(item => item.key)
  const intro = `<p class="small muted">Every failing cell, every result row the page could not read, and passing cells whose size ratio is above ${visualSizeRatio} or whose face or eyelid parameter peaks within ${Math.round(visualRangeShare * 100)}% of its range limit (a possible extreme or clipped face). The list says where to look; whether the motion looks right is not something these numbers decide.</p>`
  const list = items.length
    ? `<ul class="checklist">${items.map(item => `<li id="visual-${escapeHtml(item.key.replace(/:/g, '-'))}"><strong class="mono">${escapeHtml(item.key)}</strong> ${badge(item.verdict)} ${item.cell ? `<a href="#traj-${escapeHtml(item.cell.key.replace(':', '-'))}">trajectories</a>` : ''}<ul>${item.reasons.map(reason => `<li class="small">${escapeHtml(reason)}</li>`).join('')}</ul></li>`).join('')}</ul>`
    : `<p>No cell needs a visual check from the numbers alone.</p>`
  return { html: section('visual-check', 'For your visual check', intro + list), keys }
}

// --- Known failures ---------------------------------------------------------------------------

function knownFailuresSection(inputs: readonly RunInput[]): string {
  const runs = inputs.flatMap(run => run.test ? [{ run, summary: run.test }] : [])
  if (runs.length === 0)
    return ''
  const blocks = runs.map(({ run, summary }) => {
    const target = (t: { package: string, project: string }) => `${t.package} [${t.project}]`
    const test = (t: { package: string, project: string, file: string, name: string }) => `${target(t)} ${t.file} > ${t.name}`
    const counts = `<div class="table-wrap"><table><thead><tr><th>suite</th><th class="num">passed</th><th class="num">failed</th><th class="num">skipped</th></tr></thead><tbody>${summary.counts.map(c => `<tr><td class="mono">${escapeHtml(target(c.target))}</td><td class="num">${c.passed}</td><td class="num">${c.failed}</td><td class="num">${c.skipped}</td></tr>`).join('')}</tbody></table></div>`
    const list = (title: string, items: string[], cls = '') => `<h3>${escapeHtml(title)} (${items.length})</h3>${items.length ? `<ul class="plain ${cls}">${items.map(item => `<li>${item}</li>`).join('')}</ul>` : '<p class="small muted">none</p>'}`
    const { diff } = summary
    return `<h3>${escapeHtml(run.manifest?.runId ?? run.name)} ${badge(summary.exitCode === 0 ? 'pass' : 'fail')}</h3><p class="small muted">registry <code>${escapeHtml(summary.registry)}</code>, exit ${summary.exitCode}</p>${counts}${list('New failures (not in the registry)', diff.newFailures.map(r => `<span class="mono">${escapeHtml(test(r))}</span>${r.firstError ? `<br><span class="muted xs">${escapeHtml(r.firstError)}</span>` : ''}`))}${list('Known failing', diff.knownFailing.map(k => `<span class="mono">${escapeHtml(test(k.entry))}</span>${k.entry.flaky ? ' <span class="badge note">flaky</span>' : ''}${k.entry.reason ? `<br><span class="muted xs">${escapeHtml(k.entry.reason)}</span>` : ''}`))}${list('Fixed known failures (remove from the registry)', diff.fixedKnown.map(f => `<span class="mono">${escapeHtml(test(f.entry))}</span>${f.observed === 'not-run' ? ' <span class="badge note">not run</span>' : ''}`))}${list('Flaky entries that passed', diff.flakyPassed.map(e => `<span class="mono">${escapeHtml(test(e))}</span>`))}${summary.suiteErrors.length ? list('Suite errors', summary.suiteErrors.map(s => `<span class="mono">${escapeHtml(target(s.target))}</span>: ${escapeHtml(s.error)}`)) : ''}`
  })
  return section('known-failures', 'Known failures', blocks.join(''))
}

// --- Inputs -----------------------------------------------------------------------------------

function inputsSection(inputs: readonly RunInput[]): string {
  const rows = inputs.map((run) => {
    const facets = [run.gate ? 'gate report' : null, run.t3 ? 'T3 screenshots' : null, run.test ? 'qa:test summary' : null].filter((f): f is string => f !== null)
    const issues = run.issues.length ? `<ul class="plain">${run.issues.map(issue => `<li><span class="mono">${escapeHtml(issue.file)}</span>: ${escapeHtml(issue.problem)}</li>`).join('')}</ul>` : '<span class="muted">none</span>'
    return `<tr><td class="mono wrap">${escapeHtml(run.dir)}</td><td class="wrap">${escapeHtml(facets.join(', ') || 'nothing usable')}</td><td class="wrap">${issues}</td></tr>`
  })
  return section('inputs', 'Inputs', `<div class="table-wrap"><table><thead><tr><th class="wrap">run directory</th><th class="wrap">used as</th><th class="wrap">missing or unreadable</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`)
}

function missingInputsCallout(inputs: readonly RunInput[]): string {
  const problems = inputs.flatMap(run => run.issues.map(issue => `<li><span class="mono">${escapeHtml(run.name)}/${escapeHtml(issue.file)}</span>: ${escapeHtml(issue.problem)}</li>`))
  if (problems.length === 0)
    return ''
  const nothing = inputs.every(run => !run.gate && !run.t3 && !run.test)
  return `<div class="callout fail"><p><strong>${nothing ? 'No usable input: the sections below are empty because these files are missing or unreadable.' : 'Some inputs are missing or unreadable; the affected sections are incomplete.'}</strong></p><ul class="plain">${problems.join('')}</ul></div>`
}

// --- Page -------------------------------------------------------------------------------------

export function renderReport(options: RenderOptions): RenderedReport {
  const now = (options.now ?? (() => new Date()))()
  const inputs = options.runDirs.map(loadRunInput)
  const views: GateView[] = []
  for (const run of inputs) {
    if (!run.gate)
      continue
    const { cells, malformed } = emotionCells(run.gate.report, run.gate.partials)
    views.push({ run, report: run.gate.report, cells, malformed })
    // A result row the page cannot read is an input problem like a corrupt file: named here and in the exit code.
    for (const row of malformed)
      run.issues.push({ file: 'report.json', problem: `result ${row.key} (verdict ${row.verdict}) could not be read: ${row.problem}` })
  }
  const visual = visualSection(views)
  const toc = ['limitations', 'verdicts', 'trajectories', 't3', 'visual-check', 'known-failures', 'inputs']
  const body = [
    headerSection(inputs, now),
    `<nav class="toc">${toc.map(id => `<a href="#${id}">${escapeHtml(id.replace('-', ' '))}</a>`).join('')}</nav>`,
    limitationsSection(),
    missingInputsCallout(inputs),
    views.length ? verdictSection(views) : section('verdicts', 'Verdicts', '<p class="muted">No gate <code>report.json</code> among the inputs, so there are no verdicts to show.</p>'),
    trajectorySection(views),
    t3Section(inputs),
    visual.html,
    knownFailuresSection(inputs),
    inputsSection(inputs),
    `<footer class="xs muted"><p>${escapeHtml(reportLimitations)}</p></footer>`,
  ].join('\n')
  const html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Motion QA review report</title>\n<style>${reportStyles}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`
  return {
    html,
    inputs,
    issues: inputs.flatMap(run => run.issues.map(issue => ({ run: run.name, ...issue }))),
    visualCheck: visual.keys,
  }
}

/** Renders and writes `<firstRunDir>/report.html` (or `outFile`), overwriting any earlier report. */
export function writeReport(options: RenderOptions & { outFile?: string }): RenderedReport & { outFile: string } {
  const rendered = renderReport(options)
  const outFile = options.outFile ?? join(options.runDirs[0], 'report.html')
  writeFileSync(outFile, rendered.html)
  return { ...rendered, outFile }
}
