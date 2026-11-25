import type { ParseArgsOptionsConfig } from 'node:util'

import type { Fingerprint } from './fingerprint'
import type { ReplayOptions } from './replay'
import type { Resampled } from './track'

import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { HZ } from '@proj-airi/qa-tools/t2-3d/metrics/math'

import { fingerprint, MEASURES } from './fingerprint'
import { buildReference, compareToReference, parseReference, windowsOf } from './reference'
import { DEFAULT_REPLAY, replayTrack } from './replay'
import { loadTrack, resampleTrack } from './track'

export interface NaturalCliContext {
  /** Paths supplied by the user resolve against INIT_CWD. */
  readonly cwd: string
}

/** A usage or input error: the CLI prints it and exits 2. */
export class NaturalCliError extends Error {}

export const naturalUsage = `Usage: lab:natural <command> [arguments]

  replay --track <track.json> --out <replay.json> [--seed n] [--pep p] [--valence v] [--energy e] [--beat-bpm n]
  fingerprint <track.json>... [--json <out.json>] [--window <seconds>]
  reference --name <id> --note <text> --out <fixture.json> --window <seconds> [--segment <label>]... <track.json>...
  compare --reference <fixture.json> <track.json>...

Results inform tuning and never gate.
`

function parse<const T extends ParseArgsOptionsConfig>(args: readonly string[], options: T) {
  try {
    return parseArgs<{ args: string[], options: T, strict: true, allowPositionals: true }>({ args: [...args], options, strict: true, allowPositionals: true })
  }
  catch (error) {
    throw new NaturalCliError(errorMessageFrom(error) ?? 'invalid arguments')
  }
}

function numberOption(value: string | undefined, name: string, fallback: number, min = -Infinity, max = Infinity): number {
  if (value === undefined)
    return fallback
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed) || parsed < min || parsed > max)
    throw new NaturalCliError(`--${name} must be a number in [${min}, ${max}], got ${value}`)
  return parsed
}

function required(value: string | undefined, name: string): string {
  if (!value)
    throw new NaturalCliError(`--${name} is required`)
  return value
}

const format = (value: number | null): string => value === null ? '-' : Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(value !== 0 && Math.abs(value) < 1 ? 3 : 2)

function table(rows: readonly (readonly string[])[]): string {
  const widths = rows[0].map((_, column) => Math.max(...rows.map(row => row[column].length)))
  return rows.map(row => row.map((cell, column) => column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column])).join('  ')).join('\n')
}

async function writeJson(path: string, value: unknown, exclusive: boolean) {
  try {
    await writeFile(path, `${JSON.stringify(value, null, exclusive ? 2 : undefined)}\n`, { flag: exclusive ? 'wx' : 'w' })
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
      throw new NaturalCliError(`${path} exists; refusing to overwrite it`)
    throw error
  }
}

export async function replayCommand(args: readonly string[], context: NaturalCliContext): Promise<number> {
  const { values } = parse(args, {
    'track': { type: 'string' },
    'out': { type: 'string' },
    'seed': { type: 'string' },
    'pep': { type: 'string' },
    'valence': { type: 'string' },
    'energy': { type: 'string' },
    'beat-bpm': { type: 'string' },
  })
  const track = await loadTrack(resolve(context.cwd, required(values.track, 'track')))
  const out = resolve(context.cwd, required(values.out, 'out'))
  const options: ReplayOptions = {
    seed: numberOption(values.seed, 'seed', DEFAULT_REPLAY.seed),
    pep: numberOption(values.pep, 'pep', DEFAULT_REPLAY.pep, 0, 1),
    valence: values.valence === undefined ? null : numberOption(values.valence, 'valence', 0, -1, 1),
    energy: numberOption(values.energy, 'energy', DEFAULT_REPLAY.energy, 0, 1),
    beatBpm: values['beat-bpm'] === undefined ? null : numberOption(values['beat-bpm'], 'beat-bpm', 0, 20, 300),
  }
  const replay = replayTrack(track, options)
  await writeJson(out, replay, false)
  console.info(`REPLAY ${out} frames=${replay.voice.level.length} seed=${options.seed} pep=${options.pep}`)
  return 0
}

interface Row {
  readonly label: string
  readonly print: Fingerprint
}

async function rowsOf(paths: readonly string[], windowSeconds: number | null, context: NaturalCliContext): Promise<Row[]> {
  const rows: Row[] = []
  for (const path of paths) {
    const series = resampleTrack(await loadTrack(resolve(context.cwd, path)))
    rows.push({ label: basename(path), print: fingerprint(series) })
    if (windowSeconds !== null)
      rows.push(...windowRows(basename(path), series, windowSeconds))
  }
  return rows
}

function windowRows(label: string, series: Resampled, seconds: number): Row[] {
  const hop = seconds / 2
  const total = series.level.length / HZ
  const windows = windowsOf(series, seconds)
  const first = (total - (seconds + (windows.length - 1) * hop)) / 2
  return windows.map((window, i) => ({ label: `  ${label} @${(first + i * hop).toFixed(0)}s`, print: fingerprint(window) }))
}

export async function fingerprintCommand(args: readonly string[], context: NaturalCliContext): Promise<number> {
  const { values, positionals } = parse(args, { json: { type: 'string' }, window: { type: 'string' } })
  if (positionals.length === 0)
    throw new NaturalCliError('give at least one track')
  const windowSeconds = values.window === undefined ? null : numberOption(values.window, 'window', 60, 5)
  const rows = await rowsOf(positionals, windowSeconds, context)
  console.info(table([['track', ...MEASURES], ...rows.map(row => [row.label, ...MEASURES.map(measure => format(row.print[measure]))])]))
  if (values.json)
    await writeJson(resolve(context.cwd, values.json), rows.map(row => ({ label: row.label.trim(), ...row.print })), false)
  return 0
}

export async function referenceCommand(args: readonly string[], context: NaturalCliContext): Promise<number> {
  const { values, positionals } = parse(args, {
    name: { type: 'string' },
    note: { type: 'string' },
    out: { type: 'string' },
    window: { type: 'string' },
    segment: { type: 'string', multiple: true },
  })
  if (positionals.length === 0)
    throw new NaturalCliError('give at least one track')
  const tracks = await Promise.all(positionals.map(path => loadTrack(resolve(context.cwd, path))))
  const trackers = [...new Set(tracks.map(track => track.tracker))]
  if (trackers.length !== 1 || tracks.some(track => track.source !== 'video'))
    throw new NaturalCliError(`reference tracks must come from video and one tracker; got ${trackers.join(', ')}`)
  const reference = buildReference({
    name: required(values.name, 'name'),
    note: required(values.note, 'note'),
    tracker: trackers[0],
    windowSeconds: numberOption(required(values.window, 'window'), 'window', 60, 5),
    segments: values.segment ?? [],
    tracks: tracks.map(resampleTrack),
  })
  const out = resolve(context.cwd, required(values.out, 'out'))
  await writeJson(out, reference, true)
  console.info(`REFERENCE ${out} windows=${reference.measures.tiltSdDeg.values.length}`)
  return 0
}

export async function compareCommand(args: readonly string[], context: NaturalCliContext): Promise<number> {
  const { values, positionals } = parse(args, { reference: { type: 'string' } })
  if (positionals.length === 0)
    throw new NaturalCliError('give at least one track')
  const referencePath = resolve(context.cwd, required(values.reference, 'reference'))
  const reference = parseReference(JSON.parse(await readFile(referencePath, 'utf8')))
  console.info(`reference ${reference.name} (${reference.tracker}, ${reference.windowSeconds} s windows): ${reference.note}`)
  for (const path of positionals) {
    const print = fingerprint(resampleTrack(await loadTrack(resolve(context.cwd, path))))
    console.info(`\n${basename(path)}`)
    console.info(table([
      ['measure', 'value', 'band', 'placement'],
      ...compareToReference(print, reference).map(({ measure, value, band, placement }) =>
        [measure, format(value), band ? `[${format(band[0])}, ${format(band[1])}]` : '-', placement]),
    ]))
  }
  return 0
}
