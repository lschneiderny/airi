import type { MotionScenarioClass, MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { BvhClip } from './bvh'
import type { ReferenceClip } from './manifest'
import type { SkeletonProfile } from './skeletons'

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { encodeBlock, MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { Quaternion, Vector3 } from 'three'

import { parseBvh, ReferenceRefusal } from './bvh'
import { resolveSkeleton } from './skeletons'

export interface IngestOptions {
  readonly id: string
  readonly profile: SkeletonProfile
  readonly class: MotionScenarioClass
  readonly assetSha256: string
  /** Zero-based START inclusive, STOP exclusive, as used by 100STYLE. */
  readonly range?: { readonly start: number, readonly stop: number }
}

function sourceStride(frameTime: number): number {
  const stride = Math.round(1 / (60 * frameTime))
  // The source headers round 1/60 and 1/120 to 0.016667 and 0.0083333.
  // Accept that decimal precision, but refuse genuinely nonintegral rates.
  if (stride < 1 || Math.abs(frameTime * 60 * stride - 1) > 1e-4)
    throw new ReferenceRefusal('reference-rate', `Source frame time ${frameTime} is not an integer multiple of 60 Hz`)
  return stride
}

/** Converts the full usable span; no calibration trim, metric, or duration cap. */
export function convertBvh(clip: BvhClip, options: IngestOptions): MotionTraceV1 {
  if (!options.id || /[/\\]/.test(options.id))
    throw new ReferenceRefusal('reference-manifest', 'Clip id must be an identifier, never a file path')
  const skeleton = resolveSkeleton(clip, options.profile)
  const stride = sourceStride(clip.frameTime)
  const range = options.profile === 'cmu' ? { start: 1, stop: clip.rotations.length } : options.range
  if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.stop)
    || range.start < 0 || range.stop > clip.rotations.length || range.stop - range.start < stride) {
    throw new ReferenceRefusal('reference-range', 'Missing or invalid usable frame range')
  }
  // An incomplete final source group cannot represent a full 60 Hz sample.
  const frames = Math.floor((range.stop - range.start) / stride)
  const { bones, parents, indices, basis, restOffsets, legLength } = skeleton
  const inverseBasis = basis.clone().invert()
  const rot = new Float32Array(frames * bones.length * 4)
  const root = new Float32Array(frames * 4)
  const channels = new Float32Array(frames * MOTION_TRACE_CHANNELS.length).fill(Number.NaN)
  const previous: Quaternion[] = []
  let previousYaw = 0
  for (let frame = 0; frame < frames; frame++) {
    const sums = bones.map(() => new Quaternion(0, 0, 0, 0))
    const anchors: Quaternion[] = []
    const position = new Vector3()
    for (let sample = 0; sample < stride; sample++) {
      const sourceFrame = range.start + frame * stride + sample
      const world: Quaternion[] = []
      for (let joint = 0; joint < clip.names.length; joint++) {
        const local = new Quaternion(...clip.rotations[sourceFrame][joint])
        world.push(clip.parents[joint] < 0 ? local : world[clip.parents[joint]].clone().multiply(local))
      }
      // Fold helpers into source world orientations before averaging so the
      // same physical orientations are averaged on every skeleton.
      for (let column = 0; column < bones.length; column++) {
        const q = basis.clone().multiply(world[indices[column]]).multiply(inverseBasis).normalize()
        const sign = sample > 0 && anchors[column].dot(q) < 0 ? -1 : 1
        if (sample === 0)
          anchors.push(q.clone())
        const sum = sums[column]
        sum.set(sum.x + sign * q.x, sum.y + sign * q.y, sum.z + sign * q.z, sum.w + sign * q.w)
      }
      position.add(new Vector3(...clip.rootPositions[sourceFrame]).applyQuaternion(basis))
    }
    position.divideScalar(stride)
    const normal = sums.map(sum => sum.normalize())
    const hips = normal[bones.indexOf('hips')]
    const forward = new Vector3(0, 0, 1).applyQuaternion(hips)
    const rawYaw = Math.atan2(forward.x, forward.z)
    const yaw = frame === 0 ? rawYaw : previousYaw + Math.atan2(Math.sin(rawYaw - previousYaw), Math.cos(rawYaw - previousYaw))
    previousYaw = yaw
    for (let column = 0; column < bones.length; column++) {
      const q = parents[column] < 0
        ? new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -yaw).multiply(normal[column])
        : normal[parents[column]].clone().invert().multiply(normal[column])
      q.normalize()
      if (frame === 0 ? q.w < 0 : q.dot(previous[column]) < 0)
        q.set(-q.x, -q.y, -q.z, -q.w)
      previous[column] = q.clone()
      rot.set(q.toArray(), (frame * bones.length + column) * 4)
    }
    root.set([...position.toArray(), yaw], frame * 4)
    channels[frame * MOTION_TRACE_CHANNELS.length] = frame / 60
    channels[frame * MOTION_TRACE_CHANNELS.length + 1] = frame / 60
  }
  return {
    kind: 'motion-trace',
    version: 1,
    source: {
      level: 'reference',
      scenario: { id: options.id, class: options.class, seed: null },
      gitSha: null,
      dirty: null,
      stages: { pose: [], surface: [] },
      omitted: [],
      detail: {
        profile: options.profile,
        sourceHz: 60 * stride,
        sourceFrameTime: clip.frameTime,
        sourceStart: range.start,
        sourceStop: range.stop,
        averagedFrames: stride,
        discardedTailFrames: (range.stop - range.start) % stride,
        clock: 'nominal-60-hz',
        restRotation: 'zero-channel-world',
      },
    },
    rig: { id: options.id, assetSha256: options.assetSha256, legLength, bones, parents, restOffsets, physicsOwned: [], eyeSource: 'none', hasFingers: false },
    hz: 60,
    frames,
    scoredFrom: 0,
    rot: encodeBlock(rot),
    root: encodeBlock(root),
    channels: encodeBlock(channels),
    events: [],
  }
}

/** Reads 100STYLE's valid range; unknown clip kinds or N/A cuts are refused. */
async function frameRange(directory: string, file: string) {
  const stem = basename(file, '.bvh')
  const separator = stem.lastIndexOf('_')
  const style = stem.slice(0, separator)
  const kind = stem.slice(separator + 1)
  const rows = (await readFile(join(directory, '100style/100STYLE/Frame_Cuts.csv'), 'utf8')).trim().split(/\r?\n/).map(row => row.split(','))
  const header = rows[0]
  const row = rows.slice(1).find(row => row[0] === style)
  const start = Number(row?.[header.indexOf(`${kind}_START`)])
  const stop = Number(row?.[header.indexOf(`${kind}_STOP`)])
  if (!Number.isInteger(start) || !Number.isInteger(stop))
    throw new ReferenceRefusal('reference-range', `No frame cuts for ${stem}`)
  return { start, stop }
}

export async function ingestClip(directory: string, entry: ReferenceClip): Promise<MotionTraceV1> {
  const bytes = await readFile(join(directory, entry.file))
  const trace = convertBvh(parseBvh(bytes.toString('utf8')), {
    id: `${entry.dataset}:${basename(entry.file, '.bvh')}`,
    profile: entry.profile,
    class: entry.class,
    assetSha256: createHash('sha256').update(bytes).digest('hex'),
    range: entry.profile === '100style' ? await frameRange(directory, entry.file) : undefined,
  })
  Object.assign(trace.source.detail, { dataset: entry.dataset, subject: entry.subject, split: entry.split, role: entry.role })
  return trace
}
