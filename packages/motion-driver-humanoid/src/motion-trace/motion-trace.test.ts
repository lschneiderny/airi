import type { MotionTraceHeader } from './index'

import { describe, expect, it } from 'vitest'

import { decodeBlock, encodeBlock, motionTraceParents, MotionTraceRecorder } from './index'

const header: MotionTraceHeader = {
  kind: 'motion-trace',
  version: 1,
  source: { level: 't2-3d', scenario: { id: 'test', class: 'idle', seed: 1 }, gitSha: null, dirty: null, stages: { pose: [], surface: [] }, omitted: [], detail: {} },
  rig: { id: 'test', assetSha256: null, legLength: 1, bones: ['hips', 'head'], parents: [-1, 0], restOffsets: [[0, 0, 0], [0, 1, 0]], physicsOwned: [], eyeSource: 'none', hasFingers: false },
  hz: 60,
  scoredFrom: 0,
}
const identity = { x: 0, y: 0, z: 0, w: 1 }
const origin = { x: 0, y: 0, z: 0 }

describe('motion trace', () => {
  it('round trips two million floats bit-exactly without overflowing the decoder stack', () => {
    const bits = Uint32Array.from({ length: 2_000_000 }, (_, i) => Math.imul(i, 0x9E3779B9) >>> 0)
    const values = new Float32Array(bits.buffer)
    const decoded = decodeBlock(encodeBlock(values), values.length)
    const actual = new Uint32Array(decoded.buffer)
    expect(actual.length).toBe(bits.length)
    expect(actual.every((value, index) => value === bits[index])).toBe(true)
  })

  it('round trips float bits including noncanonical NaN payloads and subarray offsets', () => {
    const bits = new Uint32Array([123, 0x80000000, 0x7FC00123, 0x3F800001, 0xFF800000])
    const values = new Float32Array(bits.buffer, 4, 4)
    const decoded = decodeBlock(encodeBlock(values), 4)
    expect([...new Uint32Array(decoded.buffer)]).toEqual([...bits.subarray(1)])
    expect(encodeBlock(new Float32Array([1]))).toBe('AACAPw==')
    expect(() => decodeBlock('AACAPw==', 2)).toThrow(RangeError)
    expect(() => decodeBlock('!!!!', 0)).toThrow(RangeError)
  })

  it.each([
    ['AACAPx==', 1, 'Invalid motion trace block length or padding'],
    ['AAAAAAAAAAB=', 2, 'Invalid motion trace block length or padding'],
    ['AAAAAAA=', 1, 'Invalid motion trace block length or padding'],
    ['AACAPw=A', 1, 'Invalid motion trace block'],
    ['AACAPw===', 1, 'Invalid motion trace block'],
    ['AACAPw==', 2, 'Invalid motion trace block'],
    ['AACAP-==', 1, 'Invalid motion trace block'],
    ['AACAPw\n=', 1, 'Invalid motion trace block'],
    ['AACAPw==', -1, 'Invalid motion trace block'],
    ['AACAPw==', 1.5, 'Invalid motion trace block'],
  ] as const)('rejects invalid base64 %s with expected length %s', (encoded, length, message) => {
    expect(() => decodeBlock(encoded, length)).toThrow(new RangeError(message))
  })

  it('reattaches absent axial and finger joints to the nearest present ancestor', () => {
    expect(motionTraceParents(['hips', 'spine', 'neck', 'leftHand', 'leftIndexProximal', 'leftIndexDistal']))
      .toEqual([-1, 0, 1, 1, 3, 4])
  })

  it('enforces lifecycle and clears old samples and events on restart', () => {
    const recorder = new MotionTraceRecorder()
    recorder.sample(0, 0, () => identity, origin, {})
    expect(recorder.state()).toBe('idle')
    expect(() => recorder.drain()).toThrow(TypeError)
    recorder.start(header)
    expect(() => recorder.start(header)).toThrow(TypeError)
    recorder.sample(5, 8, () => identity, origin, { speaking: 0 })
    recorder.event({ t: 2, kind: 'marker', label: 'later' })
    recorder.event({ t: 1, kind: 'marker', label: 'first' })
    recorder.stop()
    recorder.sample(6, 9, () => identity, origin, {})
    recorder.event({ t: 3, kind: 'marker', label: 'ignored' })
    expect(recorder.state()).toBe('stopped')
    expect(recorder.frames).toBe(1)
    expect(recorder.drain().events?.map(event => event.t)).toEqual([1, 2])
    const channels = decodeBlock(recorder.drain().channels, 9)
    expect([...channels.subarray(0, 2)]).toEqual([0, 0])
    expect(channels[2]).toBeNaN()
    expect(channels[3]).toBe(0)
    recorder.start(header)
    recorder.stop()
    expect(recorder.drain().header?.frames).toBe(0)
    expect(recorder.drain().events).toEqual([])
  })

  it('drains full 600-frame chunks and partial ranges without changing capture data', () => {
    const recorder = new MotionTraceRecorder()
    recorder.start(header)
    for (let i = 0; i < 1201; i++)
      recorder.sample(i / 60, i / 60, () => identity, { x: i, y: 0, z: 0 }, {})
    recorder.stop()
    const full = recorder.drain()
    const parts = [recorder.drain(0, 600), recorder.drain(600, 600), recorder.drain(1200, 1)]
    for (const key of ['rot', 'root', 'channels'] as const)
      expect(parts.map(part => part[key]).join('')).toBe(full[key])
    expect(parts[1].header).toBeUndefined()
    expect(decodeBlock(recorder.drain(599, 3).root, 12)[8]).toBe(601)
    expect(() => recorder.drain(1200, 2)).toThrow(RangeError)
  })

  it('removes unwrapped hips heading and maintains quaternion hemispheres across chunks', () => {
    const recorder = new MotionTraceRecorder()
    recorder.start(header)
    for (let i = 0; i < 602; i++) {
      const yaw = i * 0.02
      const sign = i % 2 ? -1 : 1
      recorder.sample(i / 60, i / 60, () => ({ x: 0, y: sign * Math.sin(yaw / 2), z: 0, w: sign * Math.cos(yaw / 2) }), origin, {})
    }
    recorder.stop()
    const data = recorder.drain()
    const rot = decodeBlock(data.rot, 602 * 8)
    for (let i = 0; i < 602 * 2; i++)
      expect(rot[i * 4 + 3]).toBeCloseTo(1, 6)
    expect(decodeBlock(data.root, 602 * 4)[601 * 4 + 3]).toBeCloseTo(12.02, 5)
  })
})
