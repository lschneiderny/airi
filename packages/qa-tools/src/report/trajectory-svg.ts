import type { ChannelRow, EmotionCell, TrajectoryBand } from './cells'

import { emotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'

import { escapeHtml } from './html-utils'
import { axisUnit, drawnOverlays, unitLabel } from './panel-units'

/**
 * Per-cell small multiples: one panel per channel, time on x relative to the pulse. Each panel shows the gate's
 * windows, the null q90 band, the paired mean effect with its bootstrap CI over the scored window, the
 * late-window mean with its CI, the expected effect, and (when partials were present) the mean release
 * trajectory with its bootstrap band. Colors are CSS variables so the page theme owns them.
 */
const width = 720
const gutter = 118
const panelHeight = 54
const panelGap = 6
const axisHeight = 22
const headerHeight = 18
const right = 12

interface Scale {
  x: (seconds: number) => number
  y: (value: number) => number
  top: number
  bottom: number
}

const fmt = (value: number) => (Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 1 ? value.toFixed(2) : value.toPrecision(2))
const round = (value: number) => Math.round(value * 10) / 10

function windowsFor(row: ChannelRow): { domain: readonly [number, number], scored: readonly [number, number], release: readonly [number, number] | null, late: readonly [number, number] | null } {
  if (row.cls === 'modulation')
    return { domain: [-2, emotionGate.windows.modulation[1]], scored: emotionGate.windows.modulation, release: null, late: null }
  const scored = row.cls === 'posture' ? emotionGate.windows.posture : row.cls === 'eyelid' ? emotionGate.windows.eyelid : emotionGate.windows.face
  return { domain: [emotionGate.windows.baseline[0], emotionGate.release.window[1]], scored, release: emotionGate.release.window, late: emotionGate.release.late }
}

/** Symmetric y range covering every overlay the panel draws (only those in the axis units count). */
function yExtent(row: ChannelRow, drawn: readonly string[]): number {
  const { result, nullQ } = row
  const has = (kind: string) => drawn.includes(kind)
  const candidates = [
    has('effect') ? Math.abs(result.E ?? 0) : 0,
    ...(has('ci') ? (result.ci ?? []).map(Math.abs) : []),
    has('expected') ? Math.abs(result.expected ?? 0) : 0,
    has('late') ? Math.abs(result.residual?.late ?? 0) : 0,
    ...(has('lateCi') ? (result.residual?.lateCi ?? []).map(Math.abs) : []),
    has('null') ? (nullQ ?? 0) * 1.5 : 0,
    ...(has('trajectory') && row.trajectory ? [...row.trajectory.low, ...row.trajectory.high].map(Math.abs) : []),
    ...(has('release') && row.release ? [...row.release.low, ...row.release.high].map(Math.abs) : []),
  ]
  const extent = Math.max(...candidates, 1e-6)
  return extent * 1.15
}

function rect(x0: number, x1: number, scale: Scale, cls: string, title?: string): string {
  const titleTag = title ? `<title>${escapeHtml(title)}</title>` : ''
  return `<rect class="${cls}" x="${round(scale.x(x0))}" y="${scale.top}" width="${round(scale.x(x1) - scale.x(x0))}" height="${scale.bottom - scale.top}">${titleTag}</rect>`
}

function band(x0: number, x1: number, y0: number, y1: number, scale: Scale, cls: string): string {
  const top = Math.min(scale.y(y0), scale.y(y1))
  return `<rect class="${cls}" x="${round(scale.x(x0))}" y="${round(top)}" width="${round(scale.x(x1) - scale.x(x0))}" height="${round(Math.abs(scale.y(y1) - scale.y(y0)))}"/>`
}

function segment(x0: number, x1: number, y: number, scale: Scale, cls: string, title: string): string {
  return `<line class="${cls}" x1="${round(scale.x(x0))}" x2="${round(scale.x(x1))}" y1="${round(scale.y(y))}" y2="${round(scale.y(y))}"><title>${escapeHtml(title)}</title></line>`
}

function bandPath(band: TrajectoryBand, scale: Scale, cls: string, title: string): string {
  const point = (time: number, value: number) => `${round(scale.x(time))},${round(scale.y(value))}`
  const upper = band.times.map((time, i) => point(time, band.high[i]))
  const lower = band.times.map((time, i) => point(time, band.low[i])).reverse()
  return `<polygon class="${cls}-band" points="${[...upper, ...lower].join(' ')}"/><polyline class="${cls}" points="${band.times.map((time, i) => point(time, band.mean[i])).join(' ')}"><title>${escapeHtml(title)}</title></polyline>`
}

function panel(row: ChannelRow, top: number, showLabels: boolean): string {
  const { result, nullQ } = row
  const windows = windowsFor(row)
  const bottom = top + panelHeight
  // Every mark below is gated by the unit audit in `panel-units.ts`: nothing outside the axis units is drawn.
  const drawn = drawnOverlays(row)
  const show = (kind: typeof drawn[number]) => drawn.includes(kind)
  const extent = yExtent(row, drawn)
  const scale: Scale = {
    x: seconds => gutter + ((seconds - windows.domain[0]) / (windows.domain[1] - windows.domain[0])) * (width - gutter - right),
    y: value => bottom - ((value + extent) / (2 * extent)) * panelHeight,
    top,
    bottom,
  }
  const parts: string[] = []
  parts.push(`<rect class="panel" x="${gutter}" y="${top}" width="${width - gutter - right}" height="${panelHeight}"/>`)
  if (row.cls !== 'modulation')
    parts.push(rect(emotionGate.windows.baseline[0], emotionGate.windows.baseline[1], scale, 'win win-baseline', 'baseline window'))
  parts.push(rect(windows.scored[0], windows.scored[1], scale, 'win win-scored', 'scored window'))
  if (windows.release)
    parts.push(rect(windows.release[0], windows.release[1], scale, 'win win-release', 'release fit window'))
  if (windows.late)
    parts.push(rect(windows.late[0], windows.late[1], scale, 'win win-late', 'late window'))
  if (show('null') && nullQ !== null)
    parts.push(band(windows.domain[0], windows.domain[1], -nullQ, nullQ, scale, 'null-band'))
  parts.push(`<line class="zero" x1="${gutter}" x2="${width - right}" y1="${round(scale.y(0))}" y2="${round(scale.y(0))}"/>`)
  // `E` is direction-folded (positive means the recipe's direction); `expected` keeps the recipe sign, so fold it too.
  if (show('expected') && typeof result.expected === 'number')
    parts.push(segment(windows.scored[0], windows.scored[1], Math.abs(result.expected), scale, 'expected', `expected ${fmt(Math.abs(result.expected))} (direction-folded)`))
  if (show('ci') && result.ci)
    parts.push(band(windows.scored[0], windows.scored[1], result.ci[0], result.ci[1], scale, 'ci-band'))
  if (show('effect') && typeof result.E === 'number')
    parts.push(segment(windows.scored[0], windows.scored[1], result.E, scale, 'effect', `E ${fmt(result.E)}${result.ci ? ` [${fmt(result.ci[0])}, ${fmt(result.ci[1])}]` : ''}`))
  if (show('lateCi') && windows.late && result.residual?.lateCi)
    parts.push(band(windows.late[0], windows.late[1], result.residual.lateCi[0], result.residual.lateCi[1], scale, 'ci-band late-band'))
  if (show('late') && windows.late && typeof result.residual?.late === 'number')
    parts.push(segment(windows.late[0], windows.late[1], result.residual.late, scale, 'effect late', `late-window mean ${fmt(result.residual.late)}`))
  if (show('trajectory') && row.trajectory)
    parts.push(bandPath(row.trajectory, scale, 'traj', `paired mean trajectory, ${row.trajectory.trials} trials, bootstrap 95% band`))
  if (show('release') && row.release)
    parts.push(bandPath(row.release, scale, 'release', `held-only release grid (30 Hz), ${row.release.trials} trials, bootstrap 95% band`))
  const verdict = result.verdict
  parts.push(`<text class="label verdict-${verdict === 'n/a' ? 'na' : verdict}" x="${gutter - 8}" y="${top + 14}" text-anchor="end">${escapeHtml(result.channel)}</text>`)
  parts.push(`<text class="sub" x="${gutter - 8}" y="${top + 29}" text-anchor="end">${escapeHtml(verdict)}${result.failed?.length ? `: ${escapeHtml(result.failed.join(','))}` : ''}</text>`)
  parts.push(`<text class="sub" x="${gutter - 8}" y="${top + 44}" text-anchor="end">±${escapeHtml(fmt(extent))} ${escapeHtml(unitLabel(axisUnit(row.cls)))}</text>`)
  if (showLabels) {
    const label = (x0: number, x1: number, text: string) => `<text class="win-label" x="${round((scale.x(x0) + scale.x(x1)) / 2)}" y="${top - 5}" text-anchor="middle">${escapeHtml(text)}</text>`
    if (row.cls !== 'modulation')
      parts.push(label(emotionGate.windows.baseline[0], emotionGate.windows.baseline[1], 'base'))
    parts.push(label(windows.scored[0], windows.scored[1], 'scored'))
    if (windows.release)
      parts.push(label(windows.release[0], windows.release[1], 'release'))
  }
  return parts.join('')
}

function axis(row: ChannelRow, top: number): string {
  const windows = windowsFor(row)
  const x = (seconds: number) => gutter + ((seconds - windows.domain[0]) / (windows.domain[1] - windows.domain[0])) * (width - gutter - right)
  const step = windows.domain[1] - windows.domain[0] > 20 ? 10 : 1
  const ticks: number[] = []
  for (let tick = Math.ceil(windows.domain[0] / step) * step; tick <= windows.domain[1]; tick += step)
    ticks.push(tick)
  return `<g class="axis">${ticks.map(tick => `<text x="${round(x(tick))}" y="${top + 14}" text-anchor="middle">${tick}</text>`).join('')}<text x="${gutter - 8}" y="${top + 14}" text-anchor="end" class="sub">s after pulse</text></g>`
}
/** One SVG per cell. Panels that share a time domain form a block with its own axis; modulation panels use the long-hold window. */
export function cellTrajectorySvg(cell: EmotionCell): string {
  const ordered = [...cell.channels].sort((a, b) => classRank(a) - classRank(b) || a.result.channel.localeCompare(b.result.channel))
  const parts: string[] = []
  let top = headerHeight
  ordered.forEach((row, index) => {
    const previous = ordered[index - 1]
    const next = ordered[index + 1]
    const startsBlock = previous === undefined || windowsFor(previous).domain[1] !== windowsFor(row).domain[1]
    const endsBlock = next === undefined || windowsFor(next).domain[1] !== windowsFor(row).domain[1]
    parts.push(panel(row, top, startsBlock))
    top += panelHeight + panelGap
    if (endsBlock) {
      parts.push(axis(row, top))
      top += axisHeight + (next === undefined ? 0 : headerHeight)
    }
  })
  const height = top
  return `<div class="svg-wrap"><svg class="trajectory" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(`${cell.emotion} ${cell.band} trajectories`)}">${parts.join('')}</svg></div>`
}
function classRank(row: ChannelRow): number {
  return row.cls === 'face' ? 0 : row.cls === 'eyelid' ? 1 : row.cls === 'posture' ? 2 : 3
}
