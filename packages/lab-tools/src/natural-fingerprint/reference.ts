import type { Fingerprint, Measure } from './fingerprint'
import type { Resampled } from './track'

import * as v from 'valibot'

import { placeWindows } from '../t2-3d/metrics/segments'
import { fingerprint, MEASURES, sliceResampled } from './fingerprint'

const MeasureEntrySchema = v.object({
  values: v.array(v.pipe(v.number(), v.finite())),
  band: v.nullable(v.tuple([v.number(), v.number()])),
})

export const ReferenceSchema = v.object({
  format: v.literal('natural-reference'),
  version: v.literal(1),
  name: v.pipe(v.string(), v.nonEmpty()),
  note: v.string(),
  tracker: v.string(),
  windowSeconds: v.pipe(v.number(), v.minValue(1)),
  segments: v.array(v.string()),
  measures: v.object(Object.fromEntries(MEASURES.map(measure => [measure, MeasureEntrySchema])) as Record<Measure, typeof MeasureEntrySchema>),
})

/** Reference bands: each measure's per-window values across the reference tracks, and their range. */
export type NaturalReference = v.InferOutput<typeof ReferenceSchema>

export function parseReference(value: unknown): NaturalReference {
  const parsed = v.safeParse(ReferenceSchema, value)
  if (!parsed.success)
    throw new Error(`not a natural-reference file: ${v.summarize(parsed.issues)}`)
  return parsed.output
}

/** Windows of `seconds`, centred in the track at a hop of half a window; empty when the track is shorter. */
export function windowsOf(series: Resampled, seconds: number): Resampled[] {
  return placeWindows([{ start: 0, end: series.level.length }], seconds).map(span => sliceResampled(series, span))
}

export interface ReferenceInput {
  readonly name: string
  readonly note: string
  readonly tracker: string
  readonly windowSeconds: number
  readonly segments: readonly string[]
  readonly tracks: readonly Resampled[]
}

const round = (value: number): number => Math.round(value * 1e4) / 1e4

export function buildReference(input: ReferenceInput): NaturalReference {
  const windows = input.tracks.flatMap(track => windowsOf(track, input.windowSeconds)).map(fingerprint)
  if (windows.length === 0)
    throw new Error(`no track is ${input.windowSeconds} s long`)
  const measures = Object.fromEntries(MEASURES.map((measure) => {
    const values = windows.map(window => window[measure]).filter((value): value is number => value !== null)
    const band: [number, number] | null = values.length ? [Math.min(...values), Math.max(...values)] : null
    return [measure, { values: values.map(round), band: band && [round(band[0]), round(band[1])] }]
  })) as NaturalReference['measures']
  return {
    format: 'natural-reference',
    version: 1,
    name: input.name,
    note: input.note,
    tracker: input.tracker,
    windowSeconds: input.windowSeconds,
    segments: [...input.segments],
    measures,
  }
}

export type Placement = 'below' | 'inside' | 'above' | 'n/a'

export function place(value: number | null, band: readonly [number, number] | null): Placement {
  if (value === null || band === null)
    return 'n/a'
  return value < band[0] ? 'below' : value > band[1] ? 'above' : 'inside'
}

export function compareToReference(print: Fingerprint, reference: NaturalReference): { measure: Measure, value: number | null, band: readonly [number, number] | null, placement: Placement }[] {
  return MEASURES.map((measure) => {
    const band = reference.measures[measure].band
    const value = print[measure]
    // Bands are stored rounded, so the value is placed at the same precision.
    return { measure, value, band, placement: place(value === null ? null : round(value), band) }
  })
}
