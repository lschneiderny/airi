import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { MMDStanceSlots } from './stance'

import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'

import { createMMDAnimationManager } from './animation-manager'
import { MMDBody } from './body'
import { bodyFixture } from './body/fixture'
import { frameClocks, MMDStanceDirector, standingBaseMotion } from './stance'

const idle: Pick<PerformanceState, 'mode' | 'attention' | 'away'> = { mode: 'idle', attention: 'camera', away: false }
const away: Pick<PerformanceState, 'mode' | 'attention' | 'away'> = { mode: 'idle', attention: 'camera', away: true }
const EPOCH_MS = 1_000_000

function pose(name: string, center: number, legPitch: number, kneePitch: number): AnimationClip {
  const quaternion = (pitch: number) => new Quaternion().setFromEuler(new Euler(pitch, 0, 0)).toArray()
  return new AnimationClip(name, 2, [
    new VectorKeyframeTrack('.bones[センター].position', [0, 2], [0, center, 0, 0, center, 0]),
    ...['左足', '右足'].map(bone => new QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, [0, 2], [...quaternion(legPitch), ...quaternion(legPitch)])),
    ...['左ひざ', '右ひざ'].map(bone => new QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, [0, 2], [...quaternion(kneePitch), ...quaternion(kneePitch)])),
  ])
}

describe('standingBaseMotion', () => {
  it('never plays a sit or sleep slot clip as the standing idle', () => {
    expect(standingBaseMotion('sit-vmd', { sit: 'sit-vmd' })).toBeNull()
    expect(standingBaseMotion('sleep-vmd', { sleep: 'sleep-vmd' })).toBeNull()
    expect(standingBaseMotion('sit-vmd', { sit: 'sit-vmd', idle: 'breathe' })).toBe('breathe')
    expect(standingBaseMotion('breathe', { sit: 'sit-vmd' })).toBe('breathe')
    expect(standingBaseMotion('global', { idle: 'per-model' })).toBe('per-model')
    expect(standingBaseMotion('', {})).toBeNull()
  })

  it('never plays a stance clip that is also the per-model idle slot while standing', () => {
    expect(standingBaseMotion('', { idle: 'qa-sit', sit: 'qa-sit' })).toBeNull()
    expect(standingBaseMotion('qa-sit', { idle: 'qa-sit', sit: 'qa-sit' })).toBeNull()
    expect(standingBaseMotion('breathe', { idle: 'nap', sleep: 'nap' })).toBe('breathe')

    const director = new MMDStanceDirector()
    const result = director.update({ nowMs: EPOCH_MS, performance: idle, slots: { idle: 'qa-sit', sit: 'qa-sit' }, idleMotionName: '', isRegistered: () => true })
    expect(director.diagnostics.stance).toBe('stand')
    expect(result.motion).toBeNull()
  })
})

describe('mmd stance director', () => {
  const registered = () => true

  it('applies the clock offset to the director input only', () => {
    const nowMs = EPOCH_MS + 5_000
    expect(frameClocks(nowMs, 0)).toEqual({ naturalSeconds: nowMs / 1000, directorMs: nowMs })
    expect(frameClocks(nowMs, 120_000)).toEqual({ naturalSeconds: nowMs / 1000, directorMs: nowMs + 120_000 })

    const director = new MMDStanceDirector()
    const slots: MMDStanceSlots = { sit: 'sit-vmd' }
    const naturalTimes: number[] = []
    for (const offset of [0, 60_000, 120_000]) {
      const clocks = frameClocks(nowMs, offset)
      naturalTimes.push(clocks.naturalSeconds)
      director.update({ nowMs: clocks.directorMs, performance: idle, slots, idleMotionName: '', isRegistered: registered })
    }
    expect(new Set(naturalTimes).size).toBe(1)
    expect(director.diagnostics).toMatchObject({ stance: 'sit', sinceMs: nowMs + 120_000, reason: 'idle-timeout' })
  })

  it('keeps standing while away without a sleep slot, and sleeps with one', () => {
    const director = new MMDStanceDirector()
    for (let second = 0; second <= 300; second += 10)
      director.update({ nowMs: EPOCH_MS + second * 1000, performance: away, slots: { sit: 'sit-vmd' }, idleMotionName: '', isRegistered: registered })
    expect(director.diagnostics).toMatchObject({ stance: 'stand', reason: 'no-sleep-slot' })

    const result = director.update({ nowMs: EPOCH_MS + 310_000, performance: away, slots: { sleep: 'sleep-vmd' }, idleMotionName: '', isRegistered: registered })
    expect(director.diagnostics.stance).toBe('sleep')
    expect(result).toEqual({ motion: 'sleep-vmd', changed: true })
  })

  it('ignores a stance slot whose motion is not registered on this model', () => {
    const director = new MMDStanceDirector()
    director.update({ nowMs: EPOCH_MS, performance: idle, slots: { sit: 'missing' }, idleMotionName: '', isRegistered: () => false })
    director.update({ nowMs: EPOCH_MS + 200_000, performance: idle, slots: { sit: 'missing' }, idleMotionName: '', isRegistered: () => false })
    expect(director.diagnostics).toMatchObject({ stance: 'stand', reason: 'no-sit-slot' })
  })

  it('cross-fades a stance switch on the base layer without pose pops', async () => {
    const { mmd, rig, input, bones, bone } = bodyFixture()
    const animation = createMMDAnimationManager(mmd, { physicsEnabled: false })
    const director = new MMDStanceDirector()
    const body = new MMDBody(mmd, rig, { modelKey: 'stance', input: () => ({ ...input, stanceClips: director.baseClips, target: new Vector3(4, 21, 30) }) })
    animation.pipeline.poseStages.push(...body.poseStages)
    animation.pipeline.surfaceStages.push(body.surfaceStage)
    await animation.init()
    animation.registerClip('stand', pose('stand', 10, 0, 0))
    animation.registerClip('sit', pose('sit', 3.5, -80 * Math.PI / 180, 80 * Math.PI / 180))

    // The global idle names the sit clip, as the import handler would after
    // importing it first; the per-model idle slot owns standing instead.
    const slots: MMDStanceSlots = { idle: 'stand', sit: 'sit' }
    const centerY = () => mmd.mesh.worldToLocal(bone('センター').getWorldPosition(new Vector3())).y
    const previous = bones.map(b => b.getWorldQuaternion(new Quaternion()))
    let offset = 0
    let maxDelta = 0
    let standingY = Number.NaN
    let transitionFrames = 0
    for (let frame = 0; frame < 360; frame++) {
      if (frame === 120)
        offset += 120_000
      const clocks = frameClocks(EPOCH_MS + frame * 1000 / 60, offset)
      const base = director.update({ nowMs: clocks.directorMs, performance: idle, slots, idleMotionName: 'sit', isRegistered: name => animation.availableClips().includes(name) })
      if (base.changed)
        animation.setBaseMotion(base.motion)
      animation.update(1 / 60)
      if (frame === 119) {
        standingY = centerY()
        expect(animation.snapshot().idle).toBe('stand')
      }
      if (frame > 120 && centerY() < standingY - 0.01 && centerY() > standingY - 6.49)
        transitionFrames++
      if (frame > 30) {
        bones.forEach((b, index) => {
          const current = b.getWorldQuaternion(new Quaternion())
          maxDelta = Math.max(maxDelta, current.angleTo(previous[index]))
        })
      }
      bones.forEach((b, index) => b.getWorldQuaternion(previous[index]))
    }

    expect(director.diagnostics.stance).toBe('sit')
    expect(animation.snapshot().idle).toBe('sit')
    expect(standingY - centerY()).toBeGreaterThan(4)
    // 0.6 s at 60 fps; a cut would finish in one or two frames.
    expect(transitionFrames).toBeGreaterThanOrEqual(30)
    expect(transitionFrames).toBeLessThanOrEqual(40)
    expect(maxDelta * 180 / Math.PI).toBeLessThan(5)
  })
})
