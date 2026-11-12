import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

/**
 * The `frame-gap` limits of the motion3d gate, as `checkKinematics` in `../t2-3d/gate/refusals.ts` states them inline.
 * `frame-gap.test.ts` runs both on the same traces, so a change on either side fails a test instead of drifting.
 */
export const frameGapLimits = {
  /** No motion-time interval may reach this. */
  maxIntervalMs: 1000 / 20,
  /** At most `longFraction` of the intervals may exceed this. */
  longIntervalMs: 1000 / 24,
  longFraction: 0.005,
  /** Wall time minus motion time may vary by at most this over the trace. */
  wallDriftMs: 100,
} as const

export type FrameGapLimit = 'max-interval' | 'long-intervals' | 'wall-drift'

export interface FrameGapFigures {
  maxIntervalMs: number
  longIntervals: number
  longFraction: number
  wallDriftMs: number
  limits: typeof frameGapLimits
  /** The limits this trace exceeds. Any entry means the gate refuses it with `frame-gap`. */
  exceeded: FrameGapLimit[]
}

/** The gate's frame-gap figures for decoded trace channels, measured on motion time like the gate. */
export function frameGapFigures(channels: ArrayLike<number>, frames: number): FrameGapFigures {
  const stride = MOTION_TRACE_CHANNELS.length
  const times = Array.from({ length: frames }, (_, index) => channels[index * stride])
  const intervals = times.slice(1).map((time, index) => time - times[index])
  const walls = times.map((time, index) => channels[index * stride + 1] - time).filter(Number.isFinite)
  const limits = frameGapLimits
  // The gate compares seconds with a 1e-6 s tolerance; in milliseconds that is 1e-3.
  const maxInterval = intervals.length ? Math.max(...intervals) : 0
  const longIntervals = intervals.filter(interval => interval * 1000 > limits.longIntervalMs + 1e-3).length
  const wallDrift = walls.length ? Math.max(...walls) - Math.min(...walls) : 0
  const exceeded: FrameGapLimit[] = []
  if (maxInterval * 1000 >= limits.maxIntervalMs - 1e-3)
    exceeded.push('max-interval')
  if (longIntervals > intervals.length * limits.longFraction)
    exceeded.push('long-intervals')
  if (wallDrift * 1000 > limits.wallDriftMs + 1e-3)
    exceeded.push('wall-drift')
  return {
    maxIntervalMs: maxInterval * 1000,
    longIntervals,
    longFraction: intervals.length ? longIntervals / intervals.length : 0,
    wallDriftMs: wallDrift * 1000,
    limits: frameGapLimits,
    exceeded,
  }
}
