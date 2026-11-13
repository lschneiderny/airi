import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DecodedMotionTrace } from './read-trace'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { DEG } from './metrics/math'

/** Pair properties that make two runs incomparable unless `--allow-mismatch` names them. */
export const MISMATCH_FIELDS = ['scenario', 'seed', 'model', 'length'] as const
export type MismatchField = typeof MISMATCH_FIELDS[number]

export type DiffBlockName = 'header' | 'rig' | 'detail' | 'rot' | 'root' | 'channels' | 'events'

export interface LargestDifference {
  readonly what: string
  readonly value: number
  readonly unit: string
  readonly t: number
}

export interface DiffBlock {
  readonly name: DiffBlockName
  readonly identical: boolean
  /** Frame blocks: the first frame whose bits differ, with its motion time. */
  readonly first: { readonly frame: number, readonly t: number } | null
  readonly largest: readonly LargestDifference[]
  /** Record blocks: one line per differing field or event. */
  readonly notes: readonly string[]
}

export interface PairMismatch {
  readonly field: MismatchField
  readonly base: string
  readonly tip: string
}

const CHANNEL_COUNT = MOTION_TRACE_CHANNELS.length
const LENGTH_TOLERANCE_SECONDS = 1e-6
const text = (value: unknown): string => JSON.stringify(value) ?? 'undefined'

/** Scored seconds as the gate counts them: last motion time minus max(first time, scoredFrom). */
export function scoredSeconds(input: DecodedMotionTrace): number {
  const { frames, scoredFrom } = input.trace
  if (!frames)
    return 0
  const first = input.channels[0]
  const last = input.channels[(frames - 1) * CHANNEL_COUNT]
  return last - Math.max(first, scoredFrom)
}

/** The fields in which the two runs are not the same experiment: another scenario, seed, model or scored length. */
export function pairMismatches(base: DecodedMotionTrace, tip: DecodedMotionTrace): PairMismatch[] {
  const a = base.trace
  const b = tip.trace
  // A null asset hash cannot prove the model; fall back to the rig id only then.
  const model = (rig: typeof a.rig) => rig.assetSha256 ?? `rig id ${rig.id}`
  const out: PairMismatch[] = []
  // The runner records the scenario's version in source.detail; another version is another experiment.
  const scenario = (t: typeof a) => `${t.source.scenario.id} (${t.source.scenario.class}) version ${t.source.detail.scenarioVersion ?? 'unrecorded'}`
  if (scenario(a) !== scenario(b))
    out.push({ field: 'scenario', base: scenario(a), tip: scenario(b) })
  if (a.source.scenario.seed !== b.source.scenario.seed)
    out.push({ field: 'seed', base: `${a.source.scenario.seed}`, tip: `${b.source.scenario.seed}` })
  if (model(a.rig) !== model(b.rig))
    out.push({ field: 'model', base: model(a.rig), tip: model(b.rig) })
  const length = [scoredSeconds(base), scoredSeconds(tip)]
  if (Math.abs(length[0] - length[1]) > LENGTH_TOLERANCE_SECONDS)
    out.push({ field: 'length', base: `${length[0].toFixed(3)} s scored`, tip: `${length[1].toFixed(3)} s scored` })
  return out
}

function recordBlock(name: DiffBlockName, baseRecord: object, tipRecord: object): DiffBlock {
  const base: ReadonlyMap<string, unknown> = new Map(Object.entries(baseRecord))
  const tip: ReadonlyMap<string, unknown> = new Map(Object.entries(tipRecord))
  const keys = [...new Set([...base.keys(), ...tip.keys()])]
  const notes = keys.filter(key => text(base.get(key)) !== text(tip.get(key))).map(key => `${key}: ${text(base.get(key))} -> ${text(tip.get(key))}`)
  return { name, identical: !notes.length, first: null, largest: [], notes }
}

function frameTime(base: DecodedMotionTrace, tip: DecodedMotionTrace, frame: number): number {
  const source = frame < base.trace.frames ? base : tip
  return source.channels[Math.min(frame, source.trace.frames - 1) * CHANNEL_COUNT]
}

/**
 * Bit comparison of one frame block over the common frames; `columns` maps each compared column of the base row to
 * the tip row. A different frame count differs at the first frame past the shorter run.
 */
function firstDifferentFrame(base: Float32Array, tip: Float32Array, baseStride: number, tipStride: number, columns: readonly (readonly [number, number])[], frames: readonly [number, number]): number | null {
  const a = new Uint32Array(base.buffer, base.byteOffset, base.length)
  const b = new Uint32Array(tip.buffer, tip.byteOffset, tip.length)
  const common = Math.min(frames[0], frames[1])
  for (let f = 0; f < common; f++) {
    for (const [ca, cb] of columns) {
      if (a[f * baseStride + ca] !== b[f * tipStride + cb])
        return f
    }
  }
  return frames[0] === frames[1] ? null : common
}

function rotBlock(base: DecodedMotionTrace, tip: DecodedMotionTrace): DiffBlock {
  const aBones = base.trace.rig.bones
  const bBones = tip.trace.rig.bones
  const shared = aBones.flatMap((bone, i) => {
    const j = bBones.indexOf(bone)
    return j < 0 ? [] : [[bone, i, j] as const]
  })
  const columns = shared.flatMap(([, i, j]) => [0, 1, 2, 3].map(k => [i * 4 + k, j * 4 + k] as const))
  const frames = [base.trace.frames, tip.trace.frames] as const
  const first = firstDifferentFrame(base.rot, tip.rot, aBones.length * 4, bBones.length * 4, columns, frames)
  if (first === null)
    return { name: 'rot', identical: true, first: null, largest: [], notes: [] }
  let worst = { bone: shared[0]?.[0] ?? 'hips' as MotionTraceBone, deg: 0, frame: first }
  for (let f = first; f < Math.min(...frames); f++) {
    for (const [bone, i, j] of shared) {
      const p = (f * aBones.length + i) * 4
      const q = (f * bBones.length + j) * 4
      // The turn between the two rotations: 2 atan2(|v|, |w|) of conj(a) b, which reads q and -q as one pose.
      const [ax, ay, az, aw] = [-base.rot[p], -base.rot[p + 1], -base.rot[p + 2], base.rot[p + 3]]
      const [bx, by, bz, bw] = [tip.rot[q], tip.rot[q + 1], tip.rot[q + 2], tip.rot[q + 3]]
      const x = aw * bx + ax * bw + ay * bz - az * by
      const y = aw * by - ax * bz + ay * bw + az * bx
      const z = aw * bz + ax * by - ay * bx + az * bw
      const w = aw * bw - ax * bx - ay * by - az * bz
      const deg = 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w)) * DEG
      if (deg > worst.deg)
        worst = { bone, deg, frame: f }
    }
  }
  return {
    name: 'rot',
    identical: false,
    first: { frame: first, t: frameTime(base, tip, first) },
    largest: [{ what: worst.bone, value: worst.deg, unit: 'deg', t: frameTime(base, tip, worst.frame) }],
    notes: [],
  }
}

function rootBlock(base: DecodedMotionTrace, tip: DecodedMotionTrace): DiffBlock {
  const frames = [base.trace.frames, tip.trace.frames] as const
  const first = firstDifferentFrame(base.root, tip.root, 4, 4, [0, 1, 2, 3].map(k => [k, k] as const), frames)
  if (first === null)
    return { name: 'root', identical: true, first: null, largest: [], notes: [] }
  const position = { value: 0, frame: first }
  const yaw = { value: 0, frame: first }
  for (let f = first; f < Math.min(...frames); f++) {
    const o = f * 4
    const d = Math.hypot(base.root[o] - tip.root[o], base.root[o + 1] - tip.root[o + 1], base.root[o + 2] - tip.root[o + 2])
    if (d > position.value)
      Object.assign(position, { value: d, frame: f })
    const y = Math.abs(base.root[o + 3] - tip.root[o + 3]) * DEG
    if (y > yaw.value)
      Object.assign(yaw, { value: y, frame: f })
  }
  return {
    name: 'root',
    identical: false,
    first: { frame: first, t: frameTime(base, tip, first) },
    largest: [
      { what: 'hips position', value: position.value, unit: 'model units', t: frameTime(base, tip, position.frame) },
      { what: 'yaw', value: yaw.value, unit: 'deg', t: frameTime(base, tip, yaw.frame) },
    ],
    notes: [],
  }
}

function channelsBlock(base: DecodedMotionTrace, tip: DecodedMotionTrace): DiffBlock {
  const frames = [base.trace.frames, tip.trace.frames] as const
  const all = MOTION_TRACE_CHANNELS.map((_, k) => [k, k] as const)
  const first = firstDifferentFrame(base.channels, tip.channels, CHANNEL_COUNT, CHANNEL_COUNT, all, frames)
  if (first === null)
    return { name: 'channels', identical: true, first: null, largest: [], notes: [] }
  const largest: LargestDifference[] = []
  const notes: string[] = []
  for (const [k, name] of MOTION_TRACE_CHANNELS.entries()) {
    const worst = { value: 0, frame: -1 }
    let presence = 0
    for (let f = first; f < Math.min(...frames); f++) {
      const a = base.channels[f * CHANNEL_COUNT + k]
      const b = tip.channels[f * CHANNEL_COUNT + k]
      // NaN marks an absent optional channel; present on one side only is counted, not measured.
      if (Number.isNaN(a) !== Number.isNaN(b))
        presence++
      else if (!Number.isNaN(a) && Math.abs(a - b) > worst.value)
        Object.assign(worst, { value: Math.abs(a - b), frame: f })
    }
    if (worst.frame >= 0)
      largest.push({ what: name, value: worst.value, unit: '', t: frameTime(base, tip, worst.frame) })
    if (presence)
      notes.push(`${name}: present in one run only on ${presence} frames`)
  }
  return { name: 'channels', identical: false, first: { frame: first, t: frameTime(base, tip, first) }, largest, notes }
}

function eventsBlock(base: DecodedMotionTrace, tip: DecodedMotionTrace): DiffBlock {
  const a = base.trace.events
  const b = tip.trace.events
  const index = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i).find(i => text(a[i]) !== text(b[i]))
  if (index === undefined)
    return { name: 'events', identical: true, first: null, largest: [], notes: [] }
  return {
    name: 'events',
    identical: false,
    first: null,
    largest: [],
    notes: [
      `first difference at event ${index} of ${a.length} (base) and ${b.length} (tip), t ${(a[index] ?? b[index]).t.toFixed(3)} s`,
      `base: ${a[index] ? text(a[index]) : 'none'}`,
      `tip:  ${b[index] ? text(b[index]) : 'none'}`,
    ],
  }
}

/**
 * Block-by-block comparison of two decoded traces. `source.gitSha` and `source.dirty` name the commit, not the motion,
 * and are the only fields left out; frame blocks compare float32 bits on the common frames.
 */
export function diffTraces(base: DecodedMotionTrace, tip: DecodedMotionTrace): DiffBlock[] {
  const header = (input: DecodedMotionTrace) => {
    const { source, hz, frames, scoredFrom } = input.trace
    return { level: source.level, stages: source.stages, omitted: source.omitted, hz, frames, scoredFrom }
  }
  return [
    recordBlock('header', header(base), header(tip)),
    recordBlock('rig', base.trace.rig, tip.trace.rig),
    recordBlock('detail', base.trace.source.detail, tip.trace.source.detail),
    rotBlock(base, tip),
    rootBlock(base, tip),
    channelsBlock(base, tip),
    eventsBlock(base, tip),
  ]
}

export function formatDiffBlock(block: DiffBlock): string[] {
  const head = `  ${block.name.padEnd(8)} ${block.identical ? 'IDENTICAL' : 'DIFFERENT'}`
  if (block.identical)
    return [head]
  const first = block.first ? ` first differing frame ${block.first.frame} (t ${block.first.t.toFixed(3)} s)` : ''
  const largest = block.largest.map(l => `    largest ${l.what}: ${l.value.toFixed(l.unit === 'deg' ? 3 : 6)}${l.unit ? ` ${l.unit}` : ''} at t ${l.t.toFixed(3)} s`)
  return [`${head}${first}`, ...largest, ...block.notes.map(note => `    ${note}`)]
}
