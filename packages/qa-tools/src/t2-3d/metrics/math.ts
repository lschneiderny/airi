import type { Quat, Vec3 } from './types'

import { MotionTraceRefusal } from '../read-trace'

/** Refuse arithmetic failure before a comparison, clamp or peak can erase it. */
export function finite(value: number, operation: string): number {
  if (!Number.isFinite(value))
    throw new MotionTraceRefusal('trace-nonfinite', `Nonfinite ${operation}`)
  return value
}

export const sum = (x: readonly number[]): number => x.reduce((a, b) => finite(a + b, 'sum'), 0)
export const HZ = 60
export const DEG = 180 / Math.PI
export const mean = (x: readonly number[]): number => x.length ? sum(x) / x.length : 0
export const norm = (v: Vec3): number => finite(Math.hypot(...v), 'vector norm')
export const dot = (a: Vec3, b: Vec3): number => finite(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], 'dot product')
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const conjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]
export const yawQuat = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)]

export function multiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

export function normalize(q: Quat): Quat {
  const n = Math.hypot(...q)
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const r = multiply(multiply(q, [v[0], v[1], v[2], 0]), conjugate(q))
  return [r[0], r[1], r[2]]
}

export function heading(v: Vec3, yaw: number): Vec3 {
  return [Math.cos(yaw) * v[0] - Math.sin(yaw) * v[2], v[1], Math.sin(yaw) * v[0] + Math.cos(yaw) * v[2]]
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  const d = a.reduce((s, v, i) => s + v * b[i], 0)
  const sign = d < 0 ? -1 : 1
  const theta = Math.acos(Math.min(1, Math.abs(d)))
  const wa = theta < 1e-6 ? 1 - t : Math.sin((1 - t) * theta) / Math.sin(theta)
  const wb = sign * (theta < 1e-6 ? t : Math.sin(t * theta) / Math.sin(theta))
  return normalize([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb])
}

/** Section 3.1 P4: shortest Hamilton rotation vector, radians. */
export function rotationVector(q: Quat): Vec3 {
  const sign = q[3] < 0 ? -1 : 1
  const s = Math.hypot(q[0], q[1], q[2])
  return s < 1e-12 ? [0, 0, 0] : scale([q[0], q[1], q[2]], sign * 2 * Math.atan2(s, sign * q[3]) / s)
}

export function median(x: readonly number[]): number {
  for (const value of x)
    finite(value, 'median input')
  const a = [...x].sort((a, b) => a - b)
  return a.length ? finite(a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)], 'median midpoint') / 2 : 0
}

export function cv(x: readonly number[]): number | null {
  const m = mean(x)
  return m > 1e-18 ? Math.sqrt(mean(x.map(v => (v - m) ** 2))) / m : null
}

export function rms(x: readonly Vec3[]): number {
  return Math.sqrt(mean(x.map(v => dot(v, v))))
}

/** P11: 64 power iterations of the centred 3 by 3 covariance. */
export function principalAxis(x: readonly Vec3[]): Vec3 | null {
  const m: Vec3 = [mean(x.map(v => v[0])), mean(x.map(v => v[1])), mean(x.map(v => v[2]))]
  const c = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) => mean(x.map(v => (v[i] - m[i]) * (v[j] - m[j])))))
  let u: Vec3 = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]
  for (let i = 0; i < 64; i++) {
    const row = c.map(r => r[0] * u[0] + r[1] * u[1] + r[2] * u[2])
    const v: Vec3 = [row[0], row[1], row[2]]
    if (norm(v) < 1e-18)
      return null
    u = scale(v, 1 / norm(v))
  }
  return u
}

/** P12: window-centred, overlap-normalised correlation; positive lag means b follows a. */
export function laggedCorrelation(a: readonly number[], b: readonly number[], limit: number): { zero: number, peak: number, lag: number } | null {
  const ma = mean(a)
  const mb = mean(b)
  const values: number[] = []
  for (let k = -limit; k <= limit; k++) {
    let aa = 0
    let bb = 0
    let ab = 0
    for (let i = Math.max(0, -k); i < Math.min(a.length, b.length - k); i++) {
      const x = a[i] - ma
      const y = b[i + k] - mb
      aa += x * x
      bb += y * y
      ab += x * y
    }
    finite(aa, 'correlation variance')
    finite(bb, 'correlation variance')
    finite(ab, 'correlation covariance')
    const energy = finite(aa * bb, 'correlation energy product')
    values.push(energy < 1e-36 ? 0 : Math.max(-1, Math.min(1, finite(ab / Math.sqrt(energy), 'correlation'))))
  }
  if (values.every(v => v === 0))
    return null
  let best = limit
  for (let i = 0; i < values.length; i++) {
    if (Math.abs(values[i]) > Math.abs(values[best]) + 1e-12)
      best = i
  }
  const l = Math.abs(values[best - 1] ?? values[best])
  const c = Math.abs(values[best])
  const r = Math.abs(values[best + 1] ?? values[best])
  const curvature = l - 2 * c + r
  const offset = best > 0 && best < values.length - 1 && Math.abs(curvature) > 1e-18 ? 0.5 * (l - r) / curvature : 0
  return { zero: values[limit], peak: values[best], lag: best - limit + offset }
}
