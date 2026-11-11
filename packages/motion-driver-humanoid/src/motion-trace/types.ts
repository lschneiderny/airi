import type { HumanoidBoneName, HumanoidFingerBoneName } from '../types'

export const MOTION_TRACE_KIND = 'motion-trace'
export const MOTION_TRACE_VERSION = 1

export type MotionTraceBone = HumanoidBoneName | HumanoidFingerBoneName

/** Per-frame scalar channels, in this fixed order. Missing data is NaN. */
export const MOTION_TRACE_CHANNELS = [
  'time', // seconds of motion time since frame 0 (sum of pipeline dt)
  'wall', // seconds of wall time since frame 0; equals `time` in headless runs
  'voiceLevel', // 0..1, the level handed to Natural
  'speaking', // 0 or 1
  'targetX', // look target in trace axes, model units, world; NaN without a target
  'targetY',
  'targetZ',
  'locomotionMode', // 0 idle, 1 turning, 2 starting, 3 walking, 4 stopping
  'gaitWeight', // 0..1
] as const
export type MotionTraceChannel = typeof MOTION_TRACE_CHANNELS[number]

export type MotionScenarioClass = 'idle' | 'talk' | 'gaze' | 'emotion' | 'walk' | 'react'

export type MotionTraceEvent
  = | { t: number, kind: 'gaze-jump', yaw: number, pitch: number, source: 'scenario' | 'derived' }
    | { t: number, kind: 'emphasis', strength: number, source: 'scenario' | 'derived' }
    | { t: number, kind: 'emotion', emotion: string, band: 'slight' | 'clear' | 'strong', phase: 'pulse' | 'hold-start' | 'hold-end' | 'placebo', trialId?: string }
    | { t: number, kind: 'gesture', gesture: string }
    | { t: number, kind: 'gait', gait: 'liftOff' | 'heelStrike', foot: 'left' | 'right' }
    | { t: number, kind: 'goal', x: number | null, pace: 'stroll' | 'walk' | null }
    | { t: number, kind: 'touch', touch: 'poke' | 'pet-start' | 'pet-end', region?: 'head' | 'body' }
    | { t: number, kind: 'mode', mode: string }
    | { t: number, kind: 'marker', label: string }

export interface MotionTraceRig {
  /** Free text: model key or clip id. Never a file path of a personal asset. */
  id: string
  /** sha256 of the model or clip file, hex. */
  assetSha256: string | null
  /** Hip-knee-ankle length in model units; positions are divided by it in metrics. */
  legLength: number
  /** Column order of `rot`. Only bones that exist and are not physics-owned. */
  bones: MotionTraceBone[]
  /** Index into `bones` of each bone's parent, -1 for hips. */
  parents: number[]
  /** Rest position of each bone relative to its parent, trace axes, model units, [x, y, z] per bone. */
  restOffsets: [number, number, number][]
  /** Humanoid slots that exist on the rig but are physics-owned, so they are not columns. */
  physicsOwned: MotionTraceBone[]
  eyeSource: 'eyes' | 'bothEyes' | 'none'
  hasFingers: boolean
}

export interface MotionTraceSource {
  /** `t2-3d` headless runner, `rendered` scene recorder, `reference` human clip. */
  level: 't2-3d' | 'rendered' | 'reference'
  scenario: { id: string, class: MotionScenarioClass, seed: number | null }
  gitSha: string | null
  dirty: boolean | null
  /** Pose and surface stage ids in pipeline order at record start; empty for `reference`. */
  stages: { pose: string[], surface: string[] }
  /** Production work the producer did not run, for example `lip-sync`, `bone-morphs`, `render`. */
  omitted: string[]
  /** Free-form provenance: dependency versions, solver flags, clock policy, capture skeleton profile. */
  detail: Record<string, string | number | boolean | null>
}

export interface MotionTraceV1 {
  kind: typeof MOTION_TRACE_KIND
  version: typeof MOTION_TRACE_VERSION
  source: MotionTraceSource
  rig: MotionTraceRig
  /** Nominal sample rate. Headless: exactly 60. Rendered: the median rate; `time` holds the truth. */
  hz: number
  frames: number
  /** Scoring starts at this motion time in seconds; earlier frames are warm-up. */
  scoredFrom: number
  /** base64 of little-endian float32, length frames * bones.length * 4, order frame, bone, (x, y, z, w). */
  rot: string
  /** base64 of little-endian float32, length frames * 4: hips world x, y, z in model units, then yaw in radians. */
  root: string
  /** base64 of little-endian float32, length frames * MOTION_TRACE_CHANNELS.length, order frame, channel. */
  channels: string
  /** Sorted by `t`, in motion-time seconds. */
  events: MotionTraceEvent[]
}
