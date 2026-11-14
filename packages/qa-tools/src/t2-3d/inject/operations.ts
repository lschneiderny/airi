import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat, Vec3 } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'

import { MOTION_TRACE_BONES, MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import * as v from 'valibot'

import { conjugate, multiply, normalize, rotationVector, yawQuat } from '../metrics/math'

const finite = v.pipe(v.number(), v.finite())
const seconds = v.pipe(finite, v.minValue(0))
const axis = v.pipe(v.strictTuple([finite, finite, finite]), v.check(a => Math.hypot(...a) > 0, 'axis must not be zero'))
/** Rotation edits act on the bone's recorded rotation (`local`, relative to its trace parent) or its posed world orientation. */
const posed = {
  bone: v.picklist(MOTION_TRACE_BONES),
  space: v.optional(v.picklist(['local', 'world']), 'local'),
  from: v.optional(seconds),
  to: v.optional(seconds),
}
const frames = v.pipe(finite, v.integer(), v.minValue(1))

/** Every edit the harness makes, with its time window in the trace's motion seconds (`from` inclusive, `to` exclusive). */
export const operationSchema = v.variant('op', [
  v.strictObject({ op: v.literal('scale'), ...posed, factor: finite }),
  v.strictObject({ op: v.literal('shift'), ...posed, axis, deg: finite }),
  v.strictObject({ op: v.literal('sway'), ...posed, axis, deg: finite, hz: v.pipe(finite, v.minValue(Number.MIN_VALUE)) }),
  v.strictObject({ op: v.literal('freeze'), ...posed, at: seconds }),
  v.strictObject({ op: v.literal('position-step'), ...posed, axis, deg: finite, at: seconds }),
  v.strictObject({ op: v.literal('velocity-step'), ...posed, axis, degPerSecond: finite, at: seconds }),
  v.strictObject({ op: v.literal('drop-frames'), pattern: v.picklist(['single', 'pairs', 'runs']), every: frames, length: v.optional(frames), from: v.optional(seconds), to: v.optional(seconds) }),
])
export type InjectOperation = v.InferOutput<typeof operationSchema>

/** An operation that names a bone or a window the trace does not have: invalid input, never a scored case. */
export class InjectRefusal extends Error {
  override readonly name = 'InjectRefusal'
}

const CHANNELS = MOTION_TRACE_CHANNELS.length
const DEG = Math.PI / 180

function axisAngle(a: Vec3, radians: number): Quat {
  const n = Math.hypot(...a)
  const s = Math.sin(radians / 2) / n
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(radians / 2)]
}

/** q raised to the power k about the identity, along the shortest arc. */
function power(q: Quat, k: number): Quat {
  const r = rotationVector(q)
  const angle = Math.hypot(...r)
  return angle < 1e-12 ? [0, 0, 0, 1] : axisAngle(r, angle * k)
}

/** Sign-aligned, normalised mean of unit quaternions; close to the chordal L2 mean for the small spreads a window holds. */
function meanRotation(qs: readonly Quat[]): Quat {
  const sum = [0, 0, 0, 0]
  for (const q of qs) {
    const sign = q[0] * qs[0][0] + q[1] * qs[0][1] + q[2] * qs[0][2] + q[3] * qs[0][3] < 0 ? -1 : 1
    for (let k = 0; k < 4; k++)
      sum[k] += sign * q[k]
  }
  return normalize([sum[0], sum[1], sum[2], sum[3]])
}

interface Trace {
  readonly input: DecodedMotionTrace
  rot: Float32Array
  root: Float32Array
  channels: Float32Array
  frames: number
}

const timeOf = (t: Trace, i: number) => t.channels[i * CHANNELS]

function windowFrames(t: Trace, from: number | undefined, to: number | undefined, what: string): number[] {
  const last = timeOf(t, t.frames - 1)
  if ((from !== undefined && from > last) || (from !== undefined && to !== undefined && to <= from))
    throw new InjectRefusal(`${what}: window ${from ?? 0} to ${to ?? 'end'} s is outside the trace (0 to ${last} s)`)
  const list: number[] = []
  for (let i = 0; i < t.frames; i++) {
    const time = timeOf(t, i)
    if (time >= (from ?? Number.NEGATIVE_INFINITY) && time < (to ?? Number.POSITIVE_INFINITY))
      list.push(i)
  }
  if (!list.length)
    throw new InjectRefusal(`${what}: window ${from ?? 0} to ${to ?? 'end'} s holds no frame`)
  return list
}

function nearestFrame(t: Trace, at: number, what: string): number {
  if (at > timeOf(t, t.frames - 1))
    throw new InjectRefusal(`${what}: time ${at} s is after the trace's last frame`)
  let best = 0
  for (let i = 1; i < t.frames; i++) {
    if (Math.abs(timeOf(t, i) - at) < Math.abs(timeOf(t, best) - at))
      best = i
  }
  return best
}

/** Reads and writes one bone's rotation at a frame, in the trace's local space or composed to world orientation. */
function boneAccess(t: Trace, bone: MotionTraceBone, space: 'local' | 'world', what: string) {
  const bones = t.input.trace.rig.bones
  const parents = t.input.trace.rig.parents
  const b = bones.indexOf(bone)
  if (b < 0)
    throw new InjectRefusal(`${what}: the trace has no ${bone} bone`)
  const local = (i: number, k: number): Quat => {
    const o = (i * bones.length + k) * 4
    return [t.rot[o], t.rot[o + 1], t.rot[o + 2], t.rot[o + 3]]
  }
  const chain: number[] = []
  for (let k = parents[b]; k >= 0; k = parents[k])
    chain.unshift(k)
  const parentWorld = (i: number): Quat => chain.reduce<Quat>((q, k) => multiply(q, local(i, k)), yawQuat(t.root[i * 4 + 3]))
  return {
    get: (i: number): Quat => space === 'local' ? local(i, b) : multiply(parentWorld(i), local(i, b)),
    set: (i: number, q: Quat) => {
      const value = normalize(space === 'local' ? q : multiply(conjugate(parentWorld(i)), q))
      t.rot.set(value, (i * bones.length + b) * 4)
    },
  }
}

function apply(t: Trace, op: InjectOperation, what: string): void {
  if (op.op === 'drop-frames') {
    const n = op.pattern === 'single' ? 1 : op.pattern === 'pairs' ? 2 : op.length
    if (n === undefined || n >= op.every)
      throw new InjectRefusal(`${what}: drop-frames needs a run length shorter than every (${op.every}); runs needs length`)
    const window = windowFrames(t, op.from, op.to, what)
    // The first frame of every cycle is kept, so the frames before and after each dropped run stay recorded.
    const dropped = new Set(window.filter((_, j) => j % op.every >= op.every - n))
    const keep = Array.from({ length: t.frames }, (_, i) => i).filter(i => !dropped.has(i))
    const pick = (block: Float32Array, width: number) => {
      const out = new Float32Array(keep.length * width)
      keep.forEach((i, j) => out.set(block.subarray(i * width, (i + 1) * width), j * width))
      return out
    }
    t.rot = pick(t.rot, t.input.trace.rig.bones.length * 4)
    t.root = pick(t.root, 4)
    t.channels = pick(t.channels, CHANNELS)
    t.frames = keep.length
    return
  }
  const bone = boneAccess(t, op.bone, op.space, what)
  const from = op.op === 'freeze' || op.op === 'position-step' || op.op === 'velocity-step' ? op.from ?? op.at : op.from
  const window = windowFrames(t, from, op.to, what)
  const before = window.map(i => bone.get(i))
  const edit = rotationEdit(t, op, before, window, bone.get, what)
  window.forEach((i, j) => bone.set(i, edit(before[j], i)))
}

type RotationOperation = Exclude<InjectOperation, { op: 'drop-frames' }>

/** The edit of one frame's rotation `q` at frame `i`; frames outside the operation's reach keep `q`. */
function rotationEdit(t: Trace, op: RotationOperation, before: readonly Quat[], window: readonly number[], get: (i: number) => Quat, what: string): (q: Quat, i: number) => Quat {
  switch (op.op) {
    case 'scale': {
      const mean = meanRotation(before)
      return q => multiply(mean, power(multiply(conjugate(mean), q), op.factor))
    }
    case 'shift': return q => multiply(q, axisAngle(op.axis, op.deg * DEG))
    case 'sway': return (q, i) => multiply(q, axisAngle(op.axis, op.deg * DEG * Math.sin(2 * Math.PI * op.hz * (timeOf(t, i) - timeOf(t, window[0])))))
    case 'freeze': {
      const held = get(nearestFrame(t, op.at, what))
      return () => held
    }
    case 'position-step': {
      const at = nearestFrame(t, op.at, what)
      return (q, i) => i >= at ? multiply(q, axisAngle(op.axis, op.deg * DEG)) : q
    }
    case 'velocity-step': {
      const at = nearestFrame(t, op.at, what)
      return (q, i) => i > at ? multiply(q, axisAngle(op.axis, op.degPerSecond * DEG * (timeOf(t, i) - timeOf(t, at)))) : q
    }
    default: return assertNever(op)
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled operation ${JSON.stringify(value)}`)
}

/** The edited blocks of a copy of `input`; the input's arrays are never written. Operations apply in order. */
export function applyOperations(input: DecodedMotionTrace, operations: readonly InjectOperation[]): { rot: Float32Array, root: Float32Array, channels: Float32Array, frames: number } {
  const t: Trace = { input, rot: input.rot.slice(), root: input.root.slice(), channels: input.channels.slice(), frames: input.trace.frames }
  operations.forEach((op, k) => apply(t, op, `operation ${k + 1} (${op.op})`))
  return { rot: t.rot, root: t.root, channels: t.channels, frames: t.frames }
}
