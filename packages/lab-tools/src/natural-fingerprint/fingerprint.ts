import type { Span } from '@proj-airi/qa-tools/t2-3d/metrics/types'

import type { Resampled, Series } from './track'

import { HZ, mean, median } from '@proj-airi/qa-tools/t2-3d/metrics/math'

import { percentile } from '../t2-3d/gate/bands'
import { butterworth } from '../t2-3d/metrics/filter'
import { runs } from '../t2-3d/metrics/segments'

export const MEASURES = [
  'tiltSdDeg',
  'tiltRangeDeg',
  'stillShare',
  'tiltSpeedMedian',
  'swingsPerMin',
  'swingSizeDeg',
  'swingSeconds',
  'swingSharpness',
  'midBandShare',
  'blinksPerMin',
  'blinkSeconds',
  'eyesClosedShare',
  'longClosuresPerMin',
  'talkShare',
  'talkSpeedRatio',
  'onsetResponse',
  'coverage',
] as const

export type Measure = typeof MEASURES[number]

/** Each measure, or `null` where it cannot be computed (no voice, too few events). */
export type Fingerprint = Record<Measure, number | null>

/** Tilt is low-passed here first: the detector's jitter lives above it. */
const SMOOTH_HZ = 6
/** Stretches shorter than this are too short to filter and stay gaps. */
const MIN_STRETCH = HZ / 2
/** Deg/s: tilt speed under which the head counts as still. */
const STILL_DEG_PER_S = 2
/** Degrees: swing that a counted reversal must complete. */
const SWING_DEG = 8
/** Degrees: smallest reversal whose swing enters the size, length and sharpness medians. */
const SHAPE_SWING_DEG = 3
/** Share of the median eye aspect under which an eye counts as closed. */
const CLOSED_SHARE = 0.6
const BLINK_MIN_S = 0.05
const BLINK_MAX_S = 0.5
/** Talking means voiced within this many seconds. */
const TALK_RECENT_S = 0.4
/** An onset is voiced after at least this much silence. */
const ONSET_SILENCE_S = 0.6
/** Seconds after an onset over which the response is averaged. */
const ONSET_FROM_S = 0.1
const ONSET_TO_S = 0.5
/** Fewer onsets than this give no response. */
const MIN_ONSETS = 3
/** Welch segment and the shortest stretch a spectrum is taken from, in samples. */
const WELCH_SAMPLES = 60 * HZ
const MIN_SPECTRUM_SAMPLES = 10 * HZ

const present = (x: Series): number[] => x.filter((value): value is number => value !== null)
const spansOf = (x: Series): Span[] => runs(x.map(value => value !== null))

/** Zero-phase low-pass of every present stretch long enough to filter; the rest becomes a gap. */
export function smooth(x: Series, cutoff = SMOOTH_HZ): Series {
  const out: Series = x.map(() => null)
  for (const { start, end } of spansOf(x)) {
    if (end - start < MIN_STRETCH)
      continue
    butterworth(x.slice(start, end) as number[], cutoff).forEach((value, i) => {
      out[start + i] = value
    })
  }
  return out
}

/** Per-second derivative inside each present stretch: central differences, one-sided at a stretch's ends. */
export function speed(x: Series): Series {
  const out: Series = x.map(() => null)
  for (const { start, end } of spansOf(x)) {
    if (end - start < 2)
      continue
    for (let i = start; i < end; i++) {
      const lo = Math.max(start, i - 1)
      const hi = Math.min(end - 1, i + 1)
      out[i] = ((x[hi] as number) - (x[lo] as number)) / (hi - lo) * HZ
    }
  }
  return out
}

function sd(x: readonly number[]): number {
  const m = mean(x)
  return Math.sqrt(mean(x.map(value => (value - m) ** 2)))
}

/**
 * Direction reversals whose swing since the last reversal is at least `minDeg`, ported from the pilot. Returns the
 * extreme each reversal turned at, in order; the first is where the first swing started and is not a reversal.
 */
export function reversalExtremes(x: readonly number[], minDeg: number): number[] {
  if (x.length === 0)
    return []
  const extremes: number[] = []
  let hi = x[0]
  let lo = x[0]
  let hiAt = 0
  let loAt = 0
  let direction = 0
  for (let i = 1; i < x.length; i++) {
    const value = x[i]
    if (value > hi) {
      hi = value
      hiAt = i
    }
    if (value < lo) {
      lo = value
      loAt = i
    }
    if (direction >= 0 && value < hi - minDeg) {
      extremes.push(hiAt)
      direction = -1
      lo = value
      loAt = i
    }
    else if (direction <= 0 && value > lo + minDeg) {
      extremes.push(loAt)
      direction = 1
      hi = value
      hiAt = i
    }
  }
  return extremes
}

interface Swing {
  size: number
  seconds: number
  sharpness: number
}

/** Swings between consecutive reversals of at least `minDeg`, found inside each present stretch on its own. */
function swings(tilt: Series, tiltSpeed: Series, minDeg: number): Swing[] {
  const out: Swing[] = []
  for (const { start, end } of spansOf(tilt)) {
    const extremes = reversalExtremes(tilt.slice(start, end) as number[], minDeg).map(k => start + k)
    for (let k = 1; k < extremes.length; k++) {
      const a = extremes[k - 1]
      const b = extremes[k]
      const span = tiltSpeed.slice(a, b + 1)
      if (span.includes(null) || b - a < 2)
        continue
      const size = Math.abs((tilt[b] as number) - (tilt[a] as number))
      const seconds = (b - a) / HZ
      out.push({ size, seconds, sharpness: Math.max(...span.map(value => Math.abs(value as number))) / (size / seconds) })
    }
  }
  return out
}

/** Hann-windowed Welch power (mean removed per segment) at bins k * HZ / n, for k in 1..n/2. */
export function welch(x: readonly number[], n: number): { hz: number[], power: number[] } {
  const bins = Math.floor(n / 2)
  const power = Array.from<number>({ length: bins }).fill(0)
  const cos = Array.from({ length: n }, (_, i) => Math.cos(2 * Math.PI * i / n))
  const sin = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * i / n))
  const hop = Math.floor(n / 2)
  for (let start = 0; start + n <= x.length; start += hop) {
    const samples = x.slice(start, start + n)
    const m = mean(samples)
    const tapered = samples.map((value, i) => (value - m) * 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))))
    for (let k = 1; k <= bins; k++) {
      let real = 0
      let imag = 0
      for (let i = 0; i < n; i++) {
        const phase = (k * i) % n
        real += tapered[i] * cos[phase]
        imag -= tapered[i] * sin[phase]
      }
      power[k - 1] += real * real + imag * imag
    }
  }
  return { hz: power.map((_, i) => (i + 1) * HZ / n), power }
}

/** Share of the power above `floorHz` that lies in [lo, hi), on the longest present stretch; null when it is short. */
export function bandShare(x: Series, lo: number, hi: number, floorHz: number): number | null {
  const longest = spansOf(x).reduce<Span | null>((best, span) => best && best.end - best.start >= span.end - span.start ? best : span, null)
  if (!longest || longest.end - longest.start < MIN_SPECTRUM_SAMPLES)
    return null
  const samples = x.slice(longest.start, longest.end) as number[]
  const { hz, power } = welch(samples, Math.min(WELCH_SAMPLES, samples.length))
  let total = 0
  let band = 0
  hz.forEach((f, i) => {
    if (f < floorHz)
      return
    total += power[i]
    if (f >= lo && f < hi)
      band += power[i]
  })
  return total > 1e-18 ? band / total : null
}

/** Whether each frame is voiced within the last `seconds`, counting the frame itself. */
export function recentlyVoiced(voiced: readonly boolean[], seconds = TALK_RECENT_S): boolean[] {
  const frames = Math.round(seconds * HZ)
  let last = -Infinity
  return voiced.map((value, i) => {
    if (value)
      last = i
    return i - last <= frames
  })
}

/** Frames that are voiced after at least `ONSET_SILENCE_S` of silence. */
export function speechOnsets(voiced: readonly boolean[]): number[] {
  const silence = Math.round(ONSET_SILENCE_S * HZ)
  const out: number[] = []
  let last = -Infinity
  voiced.forEach((value, i) => {
    if (value && i >= silence && i - last > silence)
      out.push(i)
    if (value)
      last = i
  })
  return out
}

function eyeMeasures(series: Resampled): Pick<Fingerprint, 'blinksPerMin' | 'blinkSeconds' | 'eyesClosedShare' | 'longClosuresPerMin'> {
  const eyeOpen = series.channels.eyeOpen
  const open = present(eyeOpen)
  if (open.length === 0)
    return { blinksPerMin: null, blinkSeconds: null, eyesClosedShare: null, longClosuresPerMin: null }
  const threshold = median(open) * CLOSED_SHARE
  const face = series.channels.scale
  // On video a missing eye detection on a frame with a face is a closure; a Natural track has every frame.
  const closed = eyeOpen.map((value, i) => value === null ? series.source === 'video' && face[i] !== null : value < threshold)
  const minutes = eyeOpen.length / HZ / 60
  const lengths = runs(closed).map(({ start, end }) => (end - start) / HZ)
  const blinks = lengths.filter(seconds => seconds >= BLINK_MIN_S && seconds <= BLINK_MAX_S)
  return {
    blinksPerMin: blinks.length / minutes,
    blinkSeconds: blinks.length ? median(blinks) : null,
    eyesClosedShare: closed.filter(Boolean).length / closed.length,
    longClosuresPerMin: lengths.filter(seconds => seconds > BLINK_MAX_S).length / minutes,
  }
}

function voiceMeasures(series: Resampled, absSpeed: Series): Pick<Fingerprint, 'talkShare' | 'talkSpeedRatio' | 'onsetResponse'> {
  if (!series.voiced.includes(true))
    return { talkShare: null, talkSpeedRatio: null, onsetResponse: null }
  const talk = recentlyVoiced(series.voiced)
  const talking = present(absSpeed.map((value, i) => talk[i] ? value : null))
  const silent = present(absSpeed.map((value, i) => talk[i] ? null : value))
  const silentMedian = silent.length ? median(silent) : 0
  const talkMean = talking.length ? mean(talking) : 0
  const onsets = speechOnsets(series.voiced)
  const after = onsets.flatMap(i => present(absSpeed.slice(i + Math.round(ONSET_FROM_S * HZ), i + Math.round(ONSET_TO_S * HZ))))
  return {
    talkShare: talk.filter(Boolean).length / talk.length,
    talkSpeedRatio: talking.length && silentMedian > 1e-9 ? median(talking) / silentMedian : null,
    onsetResponse: onsets.length >= MIN_ONSETS && after.length && talkMean > 1e-9 ? mean(after) / talkMean : null,
  }
}

/** The motion fingerprint of a 60 Hz track, or of one window of it. */
export function fingerprint(series: Resampled): Fingerprint {
  const rawTilt = series.channels.tilt
  const tilt = smooth(rawTilt)
  const tiltSpeed = speed(tilt)
  const absSpeed = tiltSpeed.map(value => value === null ? null : Math.abs(value))
  const values = present(tilt)
  const speeds = present(absSpeed)
  // Reversals are counted inside each present stretch, so a jump across a tracking gap is never a swing.
  const counted = spansOf(tilt).reduce((sum, { start, end }) => sum + Math.max(0, reversalExtremes(tilt.slice(start, end) as number[], SWING_DEG).length - 1), 0)
  const shaped = swings(tilt, tiltSpeed, SHAPE_SWING_DEG)
  return {
    tiltSdDeg: values.length ? sd(values) : null,
    tiltRangeDeg: values.length ? percentile(values, 0.95) - percentile(values, 0.05) : null,
    stillShare: speeds.length ? speeds.filter(value => value < STILL_DEG_PER_S).length / speeds.length : null,
    tiltSpeedMedian: speeds.length ? median(speeds) : null,
    swingsPerMin: values.length ? counted / (values.length / HZ / 60) : null,
    swingSizeDeg: shaped.length ? median(shaped.map(s => s.size)) : null,
    swingSeconds: shaped.length ? median(shaped.map(s => s.seconds)) : null,
    swingSharpness: shaped.length ? median(shaped.map(s => s.sharpness)) : null,
    midBandShare: bandShare(tilt, 0.5, 2, 0.02),
    ...eyeMeasures(series),
    ...voiceMeasures(series, absSpeed),
    coverage: rawTilt.length ? present(rawTilt).length / rawTilt.length : null,
  }
}

/** The part of a 60 Hz track inside `span`. */
export function sliceResampled(series: Resampled, { start, end }: Span): Resampled {
  return {
    source: series.source,
    channels: Object.fromEntries(Object.entries(series.channels).map(([name, x]) => [name, x.slice(start, end)])),
    level: series.level.slice(start, end),
    voiced: series.voiced.slice(start, end),
  }
}
