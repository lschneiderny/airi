import { readFile } from 'node:fs/promises'

import { HZ } from '@proj-airi/qa-tools/t2-3d/metrics/math'

import * as v from 'valibot'

/** A sampled channel; `null` marks a frame without a detection. */
export type Series = (number | null)[]

const SeriesSchema = v.array(v.nullable(v.pipe(v.number(), v.finite())))

export const TRACK_CHANNELS = ['tilt', 'x', 'y', 'scale', 'eyeOpen'] as const

export const TrackSchema = v.pipe(
  v.object({
    format: v.literal('natural-track'),
    version: v.literal(1),
    source: v.picklist(['video', 'natural']),
    tracker: v.pipe(v.string(), v.nonEmpty()),
    fps: v.pipe(v.number(), v.finite(), v.minValue(1)),
    channels: v.objectWithRest({
      tilt: SeriesSchema,
      x: SeriesSchema,
      y: SeriesSchema,
      scale: SeriesSchema,
      eyeOpen: SeriesSchema,
    }, SeriesSchema),
    voice: v.object({
      level: v.array(v.pipe(v.number(), v.finite())),
      voiced: v.array(v.boolean()),
    }),
  }),
  v.check(
    track => Object.values(track.channels).every(series => series.length === track.voice.level.length) && track.voice.voiced.length === track.voice.level.length,
    'every channel and the voice must have the same number of frames',
  ),
)

/** A head-motion track: from a video (`track-avatar-video.py`) or a headless Natural replay. */
export type Track = v.InferOutput<typeof TrackSchema>

export function parseTrack(value: unknown): Track {
  const parsed = v.safeParse(TrackSchema, value)
  if (!parsed.success)
    throw new Error(`not a natural-track file: ${v.summarize(parsed.issues)}`)
  return parsed.output
}

export async function loadTrack(path: string): Promise<Track> {
  return parseTrack(JSON.parse(await readFile(path, 'utf8')))
}

/** Seconds of missing frames the 60 Hz resampler bridges by linear interpolation; longer gaps stay gaps. */
export const MAX_FILLED_GAP_SECONDS = 0.5

/** Linearly fills interior runs of `null` of at most `maxGap` frames; leading, trailing and longer runs stay `null`. */
export function fillGaps(x: readonly (number | null)[], maxGap: number): Series {
  const out = [...x]
  let last = -1
  for (let i = 0; i < x.length; i++) {
    const value = x[i]
    if (value === null)
      continue
    const missing = i - last - 1
    const previous = last >= 0 ? x[last] : null
    if (previous !== null && missing > 0 && missing <= maxGap) {
      for (let k = 1; k <= missing; k++)
        out[last + k] = previous + (value - previous) * k / (missing + 1)
    }
    last = i
  }
  return out
}

/**
 * Resamples a series at `fps` to 60 Hz, the rate the lab's metric helpers assume. Gaps of up to `maxGapSeconds`
 * are filled first. Between two present frames the value is interpolated linearly; next to a kept gap each sample
 * takes its nearest frame, so a kept gap keeps its length instead of growing by a frame on each side.
 */
export function resampleSeries(x: readonly (number | null)[], fps: number, maxGapSeconds = MAX_FILLED_GAP_SECONDS): Series {
  const filled = fillGaps(x, Math.round(maxGapSeconds * fps))
  const length = Math.floor(x.length / fps * HZ)
  return Array.from({ length }, (_, j) => {
    const position = j * fps / HZ
    const lower = Math.min(Math.floor(position), filled.length - 1)
    const upper = Math.min(lower + 1, filled.length - 1)
    const a = filled[lower]
    const b = filled[upper]
    const weight = position - lower
    if (a !== null && b !== null)
      return a + (b - a) * weight
    return weight < 0.5 ? a : b
  })
}

/** A track's series at 60 Hz. */
export interface Resampled {
  readonly source: Track['source']
  readonly channels: Readonly<Record<string, Series>>
  readonly level: readonly number[]
  readonly voiced: readonly boolean[]
}

/**
 * Resamples every channel and the voice to 60 Hz. Motion channels bridge short gaps; `eyeOpen` and `scale` do not,
 * because a missing eye detection on a frame with a face is the blink signal and `scale` marks where a face was found.
 */
export function resampleTrack(track: Track): Resampled {
  const channels = Object.fromEntries(Object.entries(track.channels).map(([name, series]) =>
    [name, resampleSeries(series, track.fps, name === 'eyeOpen' || name === 'scale' ? 0 : MAX_FILLED_GAP_SECONDS)]))
  const level = resampleSeries(track.voice.level, track.fps).map(value => value ?? 0)
  const frames = track.voice.voiced
  const voiced = level.map((_, j) => frames[Math.min(frames.length - 1, Math.round(j * track.fps / HZ))])
  return { source: track.source, channels, level, voiced }
}
