import { referenceStats } from './reference-stats'

/** Timestamped model units. Invalid samples and gaps above 200 ms split spans. */
export interface LivelinessTrace {
  t: Float64Array | number[]
  channels: Record<string, number[]>
  valid?: boolean[]
}

export type ParameterRanges = Record<string, { min: number, max: number, default: number }>
export interface MetricReference {
  band: [number, number] | null
  provisional: boolean
}
export interface LivelinessMetric extends MetricReference {
  value: number | null
  pass: boolean | null
}
export interface LivelinessReport {
  metrics: Record<string, LivelinessMetric>
  hardFailures: string[]
  warnings: string[]
  score: number
  pass: boolean
}

const headIds = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ']
const sdIds = [...headIds, 'ParamEyeBallX', 'ParamEyeBallY', 'ParamBrowLY', 'ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ']
// Channel SD is one score row, so each channel contributes within it.
// Each row votes once with the mean of its squared distances, so opposite-signed
// submetric errors cannot cancel.
const metricRows: Record<string, string> = {
  ...Object.fromEntries(sdIds.map(id => [`sd:${id}`, 'channelSd'])),
  still05: 'stillness',
  still2: 'stillness',
  top10PathShare: 'intermittency',
  velocityAcfCrossing: 'acfCrossing',
  eyeHeadCorrelation: 'eyeHeadCorr',
  blinkRate: 'blink',
  blinkCv: 'blink',
  loopPeak: 'loop',
  meanAngleY: 'pose',
  minuteAngleYRange: 'pose',
  angleXp5: 'pose',
  angleXp95: 'pose',
  jitter: 'jitter',
  nearLimitOccupancy: 'nearLimit',
  speedPeakP90P50: 'shiftDispersion',
  speedPeakLogAsymmetry: 'shiftDispersion',
  speedRatio: 'talking',
  onsetEnrichment: 'talking',
}
/**
 * Blink bands for generated traces: 8-20 blinks per minute,
 * inter-blink CV 0.35-0.8. Reference mode keeps the measured recording bands.
 *
 * The VTS-tracker recordings undercount blinks: 1.7-5.1 per minute with CV 1.6-4.2 is not
 * human-plausible, because missed blinks lower the rate and inflate the interval spread.
 * The blink bands are provisional, so generated motion is judged on physiology
 * until a recording with reliable eyelid tracking replaces these values.
 */
export const generatedBlinkBands: Record<'blinkRate' | 'blinkCv', MetricReference> = {
  blinkRate: { band: [8, 20], provisional: true },
  blinkCv: { band: [0.35, 0.8], provisional: true },
}

/**
 * Mouth-opening SD is report-only for generated traces. Reference mode keeps the measured band.
 *
 * The recordings' floor (0.0174) comes from tracker mouth noise. Natural opens the mouth during
 * silence at most 0.06, about once per 40 s, so even back-to-back 0.06 openings reach only about
 * 0.021 SD: meeting the floor needs a continuously cycling mouth, which the visual check forbids.
 * The node liveliness gate does not gate this metric either.
 */
export const generatedMouthOpenBand: Record<'sd:ParamMouthOpenY', MetricReference> = {
  'sd:ParamMouthOpenY': { band: null, provisional: false },
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
function sd(v: number[]) {
  const center = mean(v)
  return Math.sqrt(mean(v.map(x => (x - center) ** 2)))
}
const quantile = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * p)]

interface Span {
  t: number[]
  channels: Record<string, number[]>
}

function resample(trace: LivelinessTrace): Span[] {
  const spans: Span[] = []
  let start = 0
  for (let end = 1; end <= trace.t.length; end++) {
    if (end < trace.t.length && trace.valid?.[end] !== false && trace.valid?.[end - 1] !== false && trace.t[end] - trace.t[end - 1] <= 0.2)
      continue
    if (trace.valid?.[start] !== false) {
      const span: Span = { t: [], channels: Object.fromEntries(Object.keys(trace.channels).map(id => [id, []])) }
      let source = start
      const count = Math.floor((trace.t[end - 1] - trace.t[start]) * 30 + 1e-8)
      for (let sample = 0; sample <= count; sample++) {
        const time = trace.t[start] + sample / 30
        while (source + 1 < end && trace.t[source + 1] < time)
          source++
        const next = Math.min(source + 1, end - 1)
        const weight = next === source ? 0 : (time - trace.t[source]) / (trace.t[next] - trace.t[source])
        span.t.push(time)
        for (const [id, values] of Object.entries(trace.channels))
          span.channels[id].push(values[source] + weight * (values[next] - values[source]))
      }
      if (span.t.length > 1)
        spans.push(span)
    }
    start = end
  }
  return spans
}

// Radix-2 FFT keeps hours-long reference ACFs linearithmic without a runtime dependency.
function fft(real: Float64Array, imag: Float64Array, inverse = false) {
  const n = real.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1)
      j ^= bit
    j ^= bit
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]]
      ;[imag[i], imag[j]] = [imag[j], imag[i]]
    }
  }
  for (let length = 2; length <= n; length *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / length
    for (let offset = 0; offset < n; offset += length) {
      for (let k = 0; k < length / 2; k++) {
        const c = Math.cos(angle * k)
        const s = Math.sin(angle * k)
        const a = offset + k
        const b = a + length / 2
        const r = real[b] * c - imag[b] * s
        const im = real[b] * s + imag[b] * c
        real[b] = real[a] - r
        imag[b] = imag[a] - im
        real[a] += r
        imag[a] += im
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      real[i] /= n
      imag[i] /= n
    }
  }
}

function spectrum(values: number[], padded: boolean) {
  let size = 1
  while (size < values.length * (padded ? 2 : 1))
    size *= 2
  const real = new Float64Array(size)
  const imag = new Float64Array(size)
  const center = mean(values)
  for (let i = 0; i < values.length; i++)
    real[i] = values[i] - center
  fft(real, imag)
  return { real, imag }
}

/**
 * Head-speed peaks: local maxima above 4 units/s, at least 1 s apart within one span.
 * Higher peaks claim their neighborhood first, so a shoulder never outranks its summit.
 *
 * A lower setting (2 units/s, 0.3 s) admits so many continuous micro-motion
 * peaks that constant shift amplitudes still pass. Above 4 units/s with 1 s spacing,
 * roughly one peak per posture shift remains. p90/p50 measures the spread of shift
 * sizes and rejects constant amplitudes; the log-quantile asymmetry measures tail shape
 * and rejects wide amplitudes without a tail, such as uniform [0.1, 0.5].
 * Peak CV, skewness, and upper-quantile ratios are not gated: at this setting the
 * controller sits below their recording bands.
 */
function speedPeaks(speeds: number[]) {
  const candidates = speeds
    .map((speed, i) => ({ speed, i }))
    .filter(({ speed, i }) => i > 0 && i < speeds.length - 1 && speed > 4 && speed >= speeds[i - 1] && speed > speeds[i + 1])
    .sort((a, b) => b.speed - a.speed || a.i - b.i)
  // Samples are 1/30 s apart, so 1 s is 30 samples.
  const separation = 30
  const accepted = new Uint8Array(speeds.length)
  const peaks: number[] = []
  for (const { speed, i } of candidates) {
    if (accepted.subarray(Math.max(0, i - separation + 1), i + separation).includes(1))
      continue
    accepted[i] = 1
    peaks.push(speed)
  }
  return peaks
}

function headMotion(spans: Span[]) {
  const speeds: number[] = []
  const times: number[] = []
  const peaks: number[] = []
  const covariance = new Float64Array(1802)
  let highPower = 0
  let totalPower = 0
  for (const span of spans) {
    if (!headIds.every(id => span.channels[id]))
      continue
    const velocity = headIds.map(id => span.channels[id].slice(1).map((x, i) => (x - span.channels[id][i]) * 30))
    const spanSpeeds = velocity[0].map((_, i) => Math.hypot(...velocity.map(axis => axis[i])))
    spanSpeeds.forEach((speed, i) => {
      speeds.push(speed)
      times.push(span.t[i + 1])
    })
    peaks.push(...speedPeaks(spanSpeeds))
    for (const axis of velocity) {
      const { real, imag } = spectrum(axis, true)
      for (let i = 0; i < real.length; i++) {
        real[i] = real[i] ** 2 + imag[i] ** 2
        imag[i] = 0
      }
      fft(real, imag, true)
      for (let lag = 0; lag < Math.min(axis.length, covariance.length); lag++)
        covariance[lag] += real[lag]
    }
    for (const id of headIds) {
      const values = span.channels[id]
      const last = values.length - 1
      // Remove the endpoint ramp: the FFT wraps the span, and a first-to-last step leaks broadband power above 5 Hz.
      const { real, imag } = spectrum(values.map((value, i) => value - (values[last] - values[0]) * i / last), false)
      for (let k = 1; k <= real.length / 2; k++) {
        const power = real[k] ** 2 + imag[k] ** 2
        totalPower += power
        if (k * 30 / real.length > 5)
          highPower += power
      }
    }
  }
  const acf = Array.from(covariance, value => covariance[0] ? value / covariance[0] : 0)
  const zero = acf.findIndex(value => value <= 0)
  let loop = 0
  for (let lag = Math.max(60, zero + 1); lag <= 1800; lag++) {
    if (acf[lag] > acf[lag - 1] && acf[lag] >= acf[lag + 1])
      loop = Math.max(loop, acf[lag])
  }
  const crossing = acf.findIndex(value => value < 1 / Math.E)
  return { speeds, times, peaks, loop, crossing: crossing < 0 ? null : crossing / 30, jitter: totalPower ? highPower / totalPower : 0 }
}

/**
 * Scores the same 30 Hz contiguous-span signal used by extraction and the lab.
 * Generated mode (default) rejects head saturation. Reference mode reports it
 * without gating, because raw VTS API values may exceed declared rig ranges.
 */
export function scoreLiveliness(trace: LivelinessTrace, ranges: ParameterRanges, options: { mode?: 'generated' | 'reference' } = {}): LivelinessReport {
  const mode = options.mode ?? 'generated'
  const references = mode === 'generated' ? { ...referenceStats.bands, ...generatedBlinkBands, ...generatedMouthOpenBand } : referenceStats.bands
  const warnings: string[] = []
  if (trace.t.length < 2 || Object.values(trace.channels).some(v => v.length !== trace.t.length) || (trace.valid && trace.valid.length !== trace.t.length))
    throw new Error('Trace must contain at least two timestamps and equally sized channels/valid arrays.')
  const hardFailures: string[] = []
  if (Array.from(trace.t).some(x => !Number.isFinite(x)) || Object.values(trace.channels).some(v => v.some(x => !Number.isFinite(x))))
    return { metrics: {}, hardFailures: ['nonfinite'], warnings, score: 0, pass: false }
  if (Array.from(trace.t).some((x, i) => i > 0 && x <= trace.t[i - 1]))
    throw new Error('Trace timestamps must be strictly increasing seconds.')
  const spans = resample(trace)
  const channels = Object.fromEntries(Object.keys(trace.channels).map(id => [id, spans.flatMap(span => span.channels[id])]))
  const values: Record<string, number | null> = {}
  for (const id of sdIds)
    values[`sd:${id}`] = channels[id]?.length ? sd(channels[id]) : null
  const motion = headMotion(spans)
  const speeds = motion.speeds
  values.still05 = speeds.length ? mean(speeds.map(v => Number(v < 0.5))) : null
  values.still2 = speeds.length ? mean(speeds.map(v => Number(v < 2))) : null
  const sorted = [...speeds].sort((a, b) => b - a)
  values.top10PathShare = speeds.length && mean(speeds) > 0 ? sorted.slice(0, Math.ceil(sorted.length * 0.1)).reduce((a, b) => a + b, 0) / speeds.reduce((a, b) => a + b, 0) : null
  values.velocityAcfCrossing = speeds.length ? motion.crossing : null
  values.loopPeak = speeds.length ? motion.loop : null
  values.jitter = speeds.length ? motion.jitter : null
  // Shift-amplitude dispersion: constant-size shifts give uniform peak heights.
  const peaks = motion.peaks
  values.speedPeakP90P50 = peaks.length >= 20 ? quantile(peaks, 0.9) / quantile(peaks, 0.5) : null
  // (ln p90 - ln p50) / (ln p50 - ln p10): 1 for a lognormal, below 1 for a tail-less spread.
  // Undefined (null) when the lower half has no spread, such as identical peaks.
  const lowerLogSpread = peaks.length >= 20 ? Math.log(quantile(peaks, 0.5) / quantile(peaks, 0.1)) : 0
  values.speedPeakLogAsymmetry = lowerLogSpread > 0 ? Math.log(quantile(peaks, 0.9) / quantile(peaks, 0.5)) / lowerLogSpread : null
  const x = channels.ParamAngleX
  const eye = channels.ParamEyeBallX
  const headMean = x?.length ? mean(x) : 0
  const eyeMean = eye?.length ? mean(eye) : 0
  values.eyeHeadCorrelation = x?.length && eye?.length && sd(x) > 0 && sd(eye) > 0 ? mean(x.map((v, i) => (v - headMean) * (eye[i] - eyeMean))) / (sd(x) * sd(eye)) : null
  const y = channels.ParamAngleY
  values.meanAngleY = y?.length ? mean(y) : null
  const minutes = new Map<number, number[]>()
  for (const span of spans) {
    span.channels.ParamAngleY?.forEach((v, i) => {
      const minute = Math.floor(span.t[i] / 60)
      if (!minutes.has(minute))
        minutes.set(minute, [])
      minutes.get(minute)!.push(v)
    })
  }
  const minuteMeans = [...minutes.values()].filter(v => v.length >= 30 * 30).map(mean)
  values.minuteAngleYRange = minuteMeans.length ? Math.max(...minuteMeans) - Math.min(...minuteMeans) : null
  values.angleXp5 = x?.length ? quantile(x, 0.05) : null
  values.angleXp95 = x?.length ? quantile(x, 0.95) : null
  // Clipping is measured on head axes: eyelid closure and mouth rest are intentional limits.
  const occupancy = headIds.flatMap(id => channels[id] && ranges[id] ? channels[id].map(v => Number(Math.abs(v - (ranges[id].min + ranges[id].max) / 2) > 0.97 * (ranges[id].max - ranges[id].min) / 2)) : [])
  values.nearLimitOccupancy = occupancy.length ? mean(occupancy) : null
  const blinkTimes: number[][] = []
  let validDuration = 0
  for (const span of spans) {
    const lids = span.channels.ParamEyeLOpen
    if (!lids)
      continue
    validDuration += (span.t.length - 1) / 30
    const events: number[] = []
    let closed: number | null = null
    for (let i = 0; i < lids.length; i++) {
      const baseline = quantile(lids.slice(Math.max(0, i - 30), Math.min(lids.length, i + 31)), 0.5)
      if (lids[i] < baseline * 0.35) {
        closed ??= span.t[i]
      }
      else if (closed !== null) {
        if (span.t[i] - closed <= 0.5)
          events.push(closed)
        closed = null
      }
    }
    blinkTimes.push(events)
  }
  const intervals = blinkTimes.flatMap(events => events.slice(1).map((time, i) => time - events[i]))
  values.blinkRate = validDuration ? blinkTimes.reduce((n, v) => n + v.length, 0) * 60 / validDuration : null
  values.blinkCv = intervals.length > 1 ? sd(intervals) / mean(intervals) : null
  if (values.still05 !== null && values.still05 > 0.5)
    hardFailures.push('frozen')
  if (values.loopPeak !== null && values.loopPeak >= 0.3)
    hardFailures.push('looping')
  if (values.nearLimitOccupancy !== null && values.nearLimitOccupancy > 0.01) {
    if (mode === 'reference')
      warnings.push('clipped')
    else
      hardFailures.push('clipped')
  }
  if (!spans.length)
    hardFailures.push('no-valid-samples')
  const metrics: Record<string, LivelinessMetric> = {}
  const rows = new Map<string, number[]>()
  for (const [id, value] of Object.entries(values)) {
    const reference = references[id] ?? { band: null, provisional: false }
    const band = mode === 'reference' && id === 'nearLimitOccupancy' ? null : reference.band
    const provisional = reference.provisional
    const pass = band && value !== null ? value >= band[0] && value <= band[1] : null
    metrics[id] = { value, band, pass, provisional }
    if (band && value !== null) {
      const positive = band[0] > 0 && value > 0
      const center = positive ? (Math.log(band[0]) + Math.log(band[1])) / 2 : (band[0] + band[1]) / 2
      const width = positive ? Math.log(band[1] / band[0]) / 2 : (band[1] - band[0]) / 2
      const distance = ((positive ? Math.log(value) : value) - center) / width
      const row = metricRows[id]
      if (!rows.has(row))
        rows.set(row, [])
      rows.get(row)!.push(distance)
    }
  }
  const score = rows.size ? 100 * Math.exp(-mean([...rows.values()].map(distances => mean(distances.map(distance => distance ** 2)))) / 2) : 0
  return { metrics, hardFailures, warnings, score, pass: hardFailures.length === 0 && !Object.values(metrics).some(metric => metric.pass === false) && rows.size > 0 }
}

/** Relative-only talking criteria; no reference talking segment has been recorded. */
export function scoreTalkingRelative(talking: LivelinessTrace, idle: LivelinessTrace, onsetsSeconds: number[]) {
  const talk = headMotion(resample(talking))
  const rest = headMotion(resample(idle))
  const onsetSpeed = (offset: number) => {
    const samples = talk.speeds.filter((_, i) => onsetsSeconds.some(onset => talk.times[i] >= onset + offset && talk.times[i] < onset + offset + 0.4))
    return samples.length ? mean(samples) : null
  }
  const onset = onsetSpeed(0)
  const shifted = onsetSpeed(1.7)
  const speedRatio = talk.speeds.length && rest.speeds.length && mean(rest.speeds) > 0 ? mean(talk.speeds) / mean(rest.speeds) : null
  const onsetEnrichment = onset !== null && shifted !== null && shifted > 0 ? onset / shifted : null
  return {
    speedRatio: { value: speedRatio, ...referenceStats.talking.speedRatio, pass: speedRatio === null ? null : speedRatio >= 1.15 && speedRatio <= 1.7 },
    onsetEnrichment: { value: onsetEnrichment, ...referenceStats.talking.onsetEnrichment, pass: onsetEnrichment === null ? null : onsetEnrichment > 1.2 },
  }
}
