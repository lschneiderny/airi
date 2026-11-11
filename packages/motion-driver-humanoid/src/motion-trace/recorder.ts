import type { MotionTraceBone, MotionTraceChannel, MotionTraceEvent, MotionTraceV1 } from './types'

import { encodeBlock } from './codec'
import { MOTION_TRACE_CHANNELS } from './types'

export interface TraceQuaternion { x: number, y: number, z: number, w: number }
export type MotionTraceHeader = Omit<MotionTraceV1, 'frames' | 'rot' | 'root' | 'channels' | 'events'>
export type MotionTraceChannels = Partial<Record<Exclude<MotionTraceChannel, 'time' | 'wall'>, number>>
export type MotionTraceState = 'idle' | 'recording' | 'stopped'

function multiply(a: TraceQuaternion, b: TraceQuaternion): TraceQuaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

const CHUNK_FRAMES = 600

/** Owns one capture. start replaces stopped data; sample/event outside a capture are inert. */
export class MotionTraceRecorder {
  private status: MotionTraceState = 'idle'
  private header: MotionTraceHeader | null = null
  private chunks: { rot: Float32Array, root: Float32Array, channels: Float32Array }[] = []
  private events: MotionTraceEvent[] = []
  private previous: TraceQuaternion[] = []
  private yaw = 0
  private frameCount = 0
  private firstTime = 0
  private firstWall = 0

  get frames(): number { return this.frameCount }
  state(): MotionTraceState { return this.status }

  start(header: MotionTraceHeader): void {
    if (this.status === 'recording')
      throw new TypeError('Motion trace is already recording')
    this.header = structuredClone(header)
    this.chunks = []
    this.events = []
    this.previous = []
    this.yaw = 0
    this.frameCount = 0
    this.status = 'recording'
  }

  /** readN supplies rest-normalised world rotations already expressed in trace axes. */
  sample(time: number, wall: number, readN: (bone: MotionTraceBone) => TraceQuaternion, rootPos: { x: number, y: number, z: number }, channels: MotionTraceChannels): void {
    if (this.status !== 'recording' || !this.header)
      return
    const { bones, parents } = this.header.rig
    const world = bones.map(bone => readN(bone))
    const hips = world[bones.indexOf('hips')]
    if (hips) {
      const yaw = Math.atan2(2 * (hips.x * hips.z + hips.w * hips.y), 1 - 2 * (hips.x ** 2 + hips.y ** 2))
      this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw))
    }
    const frame = this.frameCount % CHUNK_FRAMES
    if (frame === 0) {
      this.chunks.push({
        rot: new Float32Array(CHUNK_FRAMES * bones.length * 4),
        root: new Float32Array(CHUNK_FRAMES * 4),
        channels: new Float32Array(CHUNK_FRAMES * MOTION_TRACE_CHANNELS.length),
      })
    }
    const chunk = this.chunks[Math.floor(this.frameCount / CHUNK_FRAMES)]
    world.forEach((n, index) => {
      const parent = world[parents[index]]
      const inverse = bones[index] === 'hips'
        ? { x: 0, y: -Math.sin(this.yaw / 2), z: 0, w: Math.cos(this.yaw / 2) }
        : parent ? { x: -parent.x, y: -parent.y, z: -parent.z, w: parent.w } : { x: 0, y: 0, z: 0, w: 1 }
      const q = multiply(inverse, n)
      const length = Math.hypot(q.x, q.y, q.z, q.w)
      const previous = this.previous[index]
      const dot = previous ? q.x * previous.x + q.y * previous.y + q.z * previous.z + q.w * previous.w : q.w
      const scale = (dot < 0 ? -1 : 1) / length
      const value = { x: q.x * scale, y: q.y * scale, z: q.z * scale, w: q.w * scale }
      chunk.rot.set([value.x, value.y, value.z, value.w], (frame * bones.length + index) * 4)
      this.previous[index] = value
    })
    chunk.root.set([rootPos.x, rootPos.y, rootPos.z, this.yaw], frame * 4)
    if (this.frameCount === 0) {
      this.firstTime = time
      this.firstWall = wall
    }
    const row = MOTION_TRACE_CHANNELS.map((channel) => {
      if (channel === 'time')
        return time - this.firstTime
      if (channel === 'wall')
        return wall - this.firstWall
      return channels[channel] ?? Number.NaN
    })
    chunk.channels.set(row, frame * MOTION_TRACE_CHANNELS.length)
    this.frameCount++
  }

  /** Event times are already relative to frame zero, like the stored time channel. */
  event(event: MotionTraceEvent): void {
    if (this.status === 'recording')
      this.events.push({ ...event })
  }

  stop(): void {
    if (this.status === 'recording') {
      this.events.sort((a, b) => a.t - b.t)
      this.status = 'stopped'
    }
  }

  /** Random-access, non-destructive drain after stop. Header/events are included only at from=0. */
  drain(from = 0, count = this.frameCount - from) {
    if (this.status !== 'stopped' || !this.header)
      throw new TypeError('Stop motion trace before draining')
    if (!Number.isInteger(from) || !Number.isInteger(count) || from < 0 || count < 0 || from + count > this.frameCount)
      throw new RangeError('Motion trace drain range is outside the capture')
    const block = (key: 'rot' | 'root' | 'channels', stride: number) => {
      const values = new Float32Array(count * stride)
      for (let offset = 0; offset < count;) {
        const frame = from + offset
        const local = frame % CHUNK_FRAMES
        const take = Math.min(count - offset, CHUNK_FRAMES - local)
        values.set(this.chunks[Math.floor(frame / CHUNK_FRAMES)][key].subarray(local * stride, (local + take) * stride), offset * stride)
        offset += take
      }
      return encodeBlock(values)
    }
    return {
      header: from === 0 ? { ...structuredClone(this.header), frames: this.frameCount } : undefined,
      events: from === 0 ? this.events.map(event => ({ ...event })) : undefined,
      rot: block('rot', this.header.rig.bones.length * 4),
      root: block('root', 4),
      channels: block('channels', MOTION_TRACE_CHANNELS.length),
    }
  }
}
