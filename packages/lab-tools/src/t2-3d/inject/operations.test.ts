import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat } from '../metrics'
import type { InjectOperation } from './operations'

import { describe, expect, it } from 'vitest'

import { conjugate, multiply, rotationVector } from '../metrics/math'
import { analyticTrace, angleX, angleY } from '../metrics/test-trace'
import { applyOperations, InjectRefusal } from './operations'

const BONES: readonly MotionTraceBone[] = ['hips', 'spine', 'leftUpperArm', 'leftLowerArm', 'rightUpperArm']
const DEG = Math.PI / 180
const ARM = BONES.indexOf('leftUpperArm')

/** Every bone moves, so an edit that leaks onto a neighbour or out of its window changes bits that should not change. */
function moving() {
  return analyticTrace({
    seconds: 4,
    bones: BONES,
    world: (bone, t) => bone === 'hips' ? angleY(0.3 * Math.sin(t)) : multiply(angleY(0.3 * Math.sin(t)), angleX((BONES.indexOf(bone) + 1) * 0.2 * Math.sin(2 * t + BONES.indexOf(bone)))),
    position: t => [0, 0, t],
    yaw: t => 0.3 * Math.sin(t),
  })
}

function quat(rot: Float32Array, frame: number, bone: number): Quat {
  const o = (frame * BONES.length + bone) * 4
  return [rot[o], rot[o + 1], rot[o + 2], rot[o + 3]]
}
const angle = (a: Quat, b: Quat) => Math.hypot(...rotationVector(multiply(conjugate(a), b))) / DEG
const bits = (block: Float32Array) => Array.from(new Uint32Array(block.buffer, block.byteOffset, block.length))
const time = (frame: number) => frame / 60

function changedFrames(a: Float32Array, b: Float32Array, bone: number): number[] {
  const x = bits(a)
  const y = bits(b)
  const frames: number[] = []
  for (let i = 0; i * BONES.length * 4 < x.length; i++) {
    const o = (i * BONES.length + bone) * 4
    if ([0, 1, 2, 3].some(k => x[o + k] !== y[o + k]))
      frames.push(i)
  }
  return frames
}

/** The edit lands on the named bone inside [1, 2) s only: every other bone, the root and the channels keep their bits. */
function expectOnlyArmWindow(op: InjectOperation, firstFrame = 60) {
  const input = moving()
  const before = bits(input.rot)
  const edited = applyOperations(input, [op])
  expect(bits(input.rot)).toEqual(before)
  for (let b = 0; b < BONES.length; b++) {
    if (b !== ARM)
      expect(changedFrames(input.rot, edited.rot, b)).toEqual([])
  }
  expect(bits(edited.root)).toEqual(bits(input.root))
  expect(bits(edited.channels)).toEqual(bits(input.channels))
  const changed = changedFrames(input.rot, edited.rot, ARM)
  expect(changed[0]).toBe(firstFrame)
  expect(changed.at(-1)).toBe(119)
  return { input, edited }
}

describe('fault-injection operations', () => {
  it('shifts the bone by the stated fixed rotation inside its window only', () => {
    const { input, edited } = expectOnlyArmWindow({ op: 'shift', bone: 'leftUpperArm', space: 'local', axis: [1, 0, 0], deg: 10, from: 1, to: 2 })
    expect(angle(quat(input.rot, 90, ARM), quat(edited.rot, 90, ARM))).toBeCloseTo(10, 3)
  })

  it('scales the bone about its window mean: factor 0 holds the mean, factor 2 doubles each frame\'s turn from it', () => {
    const { edited } = expectOnlyArmWindow({ op: 'scale', bone: 'leftUpperArm', space: 'local', factor: 0, from: 1, to: 2 })
    expect(angle(quat(edited.rot, 60, ARM), quat(edited.rot, 119, ARM))).toBeLessThan(1e-3)
    const input = moving()
    const doubled = applyOperations(input, [{ op: 'scale', bone: 'leftUpperArm', space: 'local', factor: 2, from: 1, to: 2 }])
    const mean = quat(edited.rot, 90, ARM)
    expect(angle(mean, quat(doubled.rot, 70, ARM))).toBeCloseTo(2 * angle(mean, quat(input.rot, 70, ARM)), 2)
  })

  it('adds a sway of the stated amplitude and frequency', () => {
    const { input, edited } = expectOnlyArmWindow({ op: 'sway', bone: 'leftUpperArm', space: 'local', axis: [0, 0, 1], deg: 8, hz: 1, from: 1, to: 2 }, 61)
    expect(angle(quat(input.rot, 75, ARM), quat(edited.rot, 75, ARM))).toBeCloseTo(8, 2)
    expect(angle(quat(input.rot, 105, ARM), quat(edited.rot, 105, ARM))).toBeCloseTo(8, 2)
  })

  it('freezes the bone at its value at the stated time through the window', () => {
    const { input, edited } = expectOnlyArmWindow({ op: 'freeze', bone: 'leftUpperArm', space: 'local', at: 1, to: 2 }, 61)
    for (let i = 60; i < 120; i++)
      expect(quat(edited.rot, i, ARM)).toEqual(quat(input.rot, 60, ARM))
  })

  it('freezes a bone\'s posed world orientation while its parent moves, rewriting only that bone\'s recorded rotation', () => {
    const input = moving()
    const lower = BONES.indexOf('leftLowerArm')
    const edited = applyOperations(input, [{ op: 'freeze', bone: 'leftLowerArm', space: 'world', at: 1, to: 2 }])
    const world = (rot: Float32Array, i: number): Quat => {
      const yaw: Quat = [0, Math.sin(input.root[i * 4 + 3] / 2), 0, Math.cos(input.root[i * 4 + 3] / 2)]
      return [0, 1, 2, 3].reduce((q, b) => multiply(q, quat(rot, i, b)), yaw)
    }
    for (const i of [70, 100, 119])
      expect(angle(world(edited.rot, i), world(input.rot, 60))).toBeLessThan(1e-3)
    for (let b = 0; b < BONES.length; b++)
      expect(changedFrames(input.rot, edited.rot, b).length > 0).toBe(b === lower)
  })

  it('makes a one-frame position step of the stated size that holds to the window end', () => {
    const { input, edited } = expectOnlyArmWindow({ op: 'position-step', bone: 'leftUpperArm', space: 'local', axis: [1, 0, 0], deg: 2.3, at: 1, to: 2 })
    for (const i of [60, 61, 119])
      expect(angle(quat(input.rot, i, ARM), quat(edited.rot, i, ARM))).toBeCloseTo(2.3, 3)
  })

  it('makes a velocity step of the stated size: the offset grows from zero at the step time', () => {
    const { input, edited } = expectOnlyArmWindow({ op: 'velocity-step', bone: 'leftUpperArm', space: 'local', axis: [1, 0, 0], degPerSecond: 60, at: 1, to: 2 }, 61)
    for (const i of [61, 90, 119])
      expect(angle(quat(input.rot, i, ARM), quat(edited.rot, i, ARM))).toBeCloseTo(60 * (time(i) - 1), 2)
  })

  it('drops recorded frames by pattern inside the window and keeps the first frame of every cycle', () => {
    const input = moving()
    const frameTimes = (channels: Float32Array) => Array.from({ length: channels.length / 9 }, (_, i) => Math.round(channels[i * 9] * 60))
    const all = frameTimes(input.channels)
    const cases = [
      { pattern: 'single', every: 3, dropped: (j: number) => j % 3 === 2 },
      { pattern: 'pairs', every: 5, dropped: (j: number) => j % 5 >= 3 },
      { pattern: 'runs', every: 6, length: 4, dropped: (j: number) => j % 6 >= 2 },
    ] as const
    for (const c of cases) {
      const edited = applyOperations(input, [{ op: 'drop-frames', pattern: c.pattern, every: c.every, ...('length' in c ? { length: c.length } : {}), from: 1, to: 2 }])
      const kept = all.filter(i => i < 60 || i >= 120 || !c.dropped(i - 60))
      expect(frameTimes(edited.channels)).toEqual(kept)
      expect(edited.frames).toBe(kept.length)
      expect(edited.rot.length).toBe(kept.length * BONES.length * 4)
      kept.forEach((frame, j) => expect(bits(edited.rot.subarray(j * BONES.length * 4, (j + 1) * BONES.length * 4))).toEqual(bits(input.rot.subarray(frame * BONES.length * 4, (frame + 1) * BONES.length * 4))))
    }
  })

  it('refuses a bone the trace lacks, a window outside the trace and a run as long as its cycle', () => {
    const input = moving()
    expect(() => applyOperations(input, [{ op: 'freeze', bone: 'rightFoot', space: 'local', at: 1 }])).toThrow(InjectRefusal)
    expect(() => applyOperations(input, [{ op: 'shift', bone: 'spine', space: 'local', axis: [1, 0, 0], deg: 5, from: 9, to: 10 }])).toThrow(InjectRefusal)
    expect(() => applyOperations(input, [{ op: 'drop-frames', pattern: 'pairs', every: 2 }])).toThrow(InjectRefusal)
  })
})
