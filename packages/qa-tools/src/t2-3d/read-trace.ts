import type { MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { readFile } from 'node:fs/promises'

import { decodeBlock, MOTION_TRACE_BONES, MOTION_TRACE_CHANNELS, motionTraceParents } from '@proj-airi/motion-driver-humanoid/motion-trace'

import * as v from 'valibot'

export type MotionTraceRefusalName = 'trace-unreadable' | 'trace-kind' | 'trace-shape' | 'trace-nonfinite' | 'trace-unnormalized' | 'time-nonmonotonic'

/** Structural refusals are invalid input, never a scored pass or failure. */
export class MotionTraceRefusal extends Error {
  constructor(override readonly name: MotionTraceRefusalName, readonly detail: string) {
    super(`${name}: ${detail}`)
  }
}

export interface DecodedMotionTrace {
  readonly trace: MotionTraceV1
  readonly rot: Float32Array
  readonly root: Float32Array
  readonly channels: Float32Array
}

const finite = v.pipe(v.number(), v.finite())
const integer = v.pipe(finite, v.integer())
const nonnegative = v.pipe(finite, v.minValue(0))
const sha256 = v.nullable(v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/i)))
const bone = v.picklist(MOTION_TRACE_BONES)
const origin = v.picklist(['scenario', 'derived'])
const band = v.picklist(['slight', 'clear', 'strong'])
const pace = v.picklist(['stroll', 'walk'])
const eventSchema = v.variant('kind', [
  v.object({ t: finite, kind: v.literal('gaze-jump'), yaw: finite, pitch: finite, source: origin }),
  v.object({ t: finite, kind: v.literal('emphasis'), strength: finite, source: origin }),
  v.object({ t: finite, kind: v.literal('emotion'), emotion: v.string(), band, phase: v.picklist(['pulse', 'hold-start', 'hold-end', 'placebo']), trialId: v.optional(v.string()) }),
  v.object({ t: finite, kind: v.literal('gesture'), gesture: v.string() }),
  v.object({ t: finite, kind: v.literal('gait'), gait: v.picklist(['liftOff', 'heelStrike']), foot: v.picklist(['left', 'right']) }),
  v.object({ t: finite, kind: v.literal('goal'), x: v.nullable(finite), pace: v.nullable(pace) }),
  v.object({ t: finite, kind: v.literal('touch'), touch: v.picklist(['poke', 'pet-start', 'pet-end']), region: v.optional(v.picklist(['head', 'body'])) }),
  v.object({ t: finite, kind: v.literal('mode'), mode: v.string() }),
  v.object({ t: finite, kind: v.literal('marker'), label: v.string() }),
])

const traceSchema = v.object({
  kind: v.literal('motion-trace'),
  version: v.literal(1),
  source: v.object({
    level: v.picklist(['t2-3d', 'rendered', 'reference']),
    scenario: v.object({ id: v.string(), class: v.picklist(['idle', 'talk', 'gaze', 'emotion', 'walk', 'react']), seed: v.nullable(integer) }),
    gitSha: v.nullable(v.string()),
    dirty: v.nullable(v.boolean()),
    stages: v.object({ pose: v.array(v.string()), surface: v.array(v.string()) }),
    omitted: v.array(v.string()),
    detail: v.record(v.string(), v.union([v.string(), finite, v.boolean(), v.null()])),
  }),
  rig: v.object({
    id: v.string(),
    assetSha256: sha256,
    legLength: v.pipe(finite, v.minValue(Number.MIN_VALUE, 'rig.legLength must be finite and greater than 0')),
    bones: v.array(bone),
    parents: v.array(integer),
    restOffsets: v.array(v.strictTuple([finite, finite, finite])),
    physicsOwned: v.array(bone),
    eyeSource: v.picklist(['eyes', 'bothEyes', 'none']),
    hasFingers: v.boolean(),
  }),
  hz: v.pipe(finite, v.minValue(Number.MIN_VALUE)),
  frames: v.pipe(integer, v.minValue(0)),
  scoredFrom: nonnegative,
  rot: v.string(),
  root: v.string(),
  channels: v.string(),
  events: v.array(eventSchema),
}) satisfies v.GenericSchema<MotionTraceV1>

/** Parses the complete file boundary and decodes once; scoring consumes these arrays directly. */
export function parseTrace(input: unknown): DecodedMotionTrace {
  const identity = v.safeParse(v.object({ kind: v.literal('motion-trace'), version: v.literal(1) }), input)
  if (!identity.success)
    throw new MotionTraceRefusal('trace-kind', 'Expected motion-trace version 1')
  const parsed = v.safeParse(traceSchema, input)
  if (!parsed.success)
    throw new MotionTraceRefusal('trace-shape', v.summarize(parsed.issues))
  const trace = parsed.output
  const { bones, parents, restOffsets, physicsOwned } = trace.rig
  const canonicalParents = motionTraceParents(bones)
  if (parents.length !== bones.length || parents.some((parent, index) => parent !== canonicalParents[index]))
    throw new MotionTraceRefusal('trace-shape', 'rig.parents must use the canonical nearest-present-ancestor mapping')
  if (parents.length !== bones.length || restOffsets.length !== bones.length
    || parents.some((parent, index) => parent < -1 || parent >= index)
    || new Set(bones).size !== bones.length || bones.some(bone => physicsOwned.includes(bone))
    || trace.events.some((event, index) => index > 0 && event.t < trace.events[index - 1].t)) {
    throw new MotionTraceRefusal('trace-shape', 'Invalid hierarchy, columns or event order')
  }
  let rot: Float32Array
  let root: Float32Array
  let channels: Float32Array
  try {
    rot = decodeBlock(trace.rot, trace.frames * bones.length * 4)
    root = decodeBlock(trace.root, trace.frames * 4)
    channels = decodeBlock(trace.channels, trace.frames * MOTION_TRACE_CHANNELS.length)
  }
  catch (error) {
    if (error instanceof RangeError || error instanceof DOMException)
      throw new MotionTraceRefusal('trace-shape', error.message)
    throw error
  }
  if (rot.some(value => !Number.isFinite(value)) || root.some(value => !Number.isFinite(value)))
    throw new MotionTraceRefusal('trace-nonfinite', 'Nonfinite rotation or root value')
  // voiceLevel, speaking, targetX/Y/Z, locomotionMode and gaitWeight are
  // optional scalar channels: NaN means absent. Neither clock is optional.
  for (const [index, value] of channels.entries()) {
    const channel = MOTION_TRACE_CHANNELS[index % MOTION_TRACE_CHANNELS.length]
    if ((channel === 'time' || channel === 'wall') ? !Number.isFinite(value) : !Number.isFinite(value) && !Number.isNaN(value))
      throw new MotionTraceRefusal('trace-nonfinite', `Nonfinite ${channel} at frame ${Math.floor(index / MOTION_TRACE_CHANNELS.length)}`)
  }
  for (let i = 0; i < rot.length; i += 4) {
    if (Math.abs(Math.hypot(rot[i], rot[i + 1], rot[i + 2], rot[i + 3]) - 1) > 1e-3)
      throw new MotionTraceRefusal('trace-unnormalized', `Quaternion ${i / 4} is not unit length`)
  }
  for (let i = 0; i < trace.frames; i++) {
    const t = channels[i * MOTION_TRACE_CHANNELS.length]
    if (!Number.isFinite(t))
      throw new MotionTraceRefusal('trace-nonfinite', `Nonfinite time at frame ${i}`)
    if (i > 0 && t <= channels[(i - 1) * MOTION_TRACE_CHANNELS.length])
      throw new MotionTraceRefusal('time-nonmonotonic', `Time did not increase at frame ${i}`)
  }
  return { trace, rot, root, channels }
}

export async function readTrace(path: string): Promise<DecodedMotionTrace> {
  let input: unknown
  try {
    input = JSON.parse(await readFile(path, 'utf8'))
  }
  catch (error) {
    if (error instanceof Error)
      throw new MotionTraceRefusal('trace-unreadable', error.message)
    throw error
  }
  return parseTrace(input)
}
