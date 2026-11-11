import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DecodedMotionTrace } from '../read-trace'

export type Vec3 = readonly [number, number, number]
export type Quat = readonly [number, number, number, number]
export type Region = 'head' | 'trunk' | 'armL' | 'armR' | 'legs'
export type BoneSeries<T> = Readonly<Partial<Record<MotionTraceBone, readonly T[]>>>
export type BoneFloors = Readonly<Partial<Record<MotionTraceBone, number>>>

/** All detector scales are supplied by the caller, in rad/s. No fitted values live here. */
export interface DetectorParameters {
  readonly floors: BoneFloors
  readonly moveSpeed: Readonly<Record<Region | 'body', number>>
  readonly acceptedHeadRotationDeg?: readonly [number, number]
}

/** Half-open sample interval, on the 60 Hz velocity grid. */
export interface Span {
  readonly start: number
  readonly end: number
}

export interface Episode extends Span {
  readonly peak: number
}

export interface Segment extends Span {
  readonly moving: boolean
}

export interface PreparedTrace {
  readonly input: DecodedMotionTrace
  readonly times: readonly number[]
  readonly orientations: BoneSeries<Quat>
  readonly worldVelocity: BoneSeries<Vec3>
  readonly o6: BoneSeries<Vec3>
  readonly o15: BoneSeries<Vec3>
  readonly rootPosition: readonly Vec3[]
  readonly rootVelocity: readonly Vec3[]
  readonly yaw: readonly number[]
  readonly yawRate: readonly number[]
  readonly channels: readonly (readonly number[])[]
  readonly bodySpeed: readonly number[]
  readonly regionSpeed: Readonly<Record<Region, readonly number[]>>
  readonly eligibleSpans: readonly Span[]
  readonly windows: readonly Span[]
  readonly windowSeconds: number
}

export type MetricStatus = 'ok' | 'undefined: no-motion' | `skipped: ${string}`
export type MetricBasis = 'window' | 'episode' | 'trace'
export interface MetricSample extends Span {
  readonly value: number
}

/** Values are raw measurements. Gate policy, transforms and bands belong to the consumer. */
export interface MetricResult {
  readonly id: string
  readonly family: string
  readonly value: number | null
  readonly unit: string
  readonly status: MetricStatus
  readonly detail: string
  readonly basis: MetricBasis
  readonly samples: readonly MetricSample[]
}
