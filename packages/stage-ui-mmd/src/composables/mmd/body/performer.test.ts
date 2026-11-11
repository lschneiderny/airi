import type { BodyGestureReport, BodyPerformanceInput, LayerOutput, PerformanceLayer } from '@proj-airi/motion-driver-humanoid/performance'

import type { MMDBodyEvent } from './performer'

import { BODY_CHANNELS, BODY_TICK, BodySkeleton, channelIndex } from '@proj-airi/motion-driver-humanoid/performance'
import { Euler, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { bodyFixture, cursorAt } from './fixture'
import { MMDBody } from './index'
import { MMDBodyPerformer } from './performer'
import { MMDBodyPose } from './pose'
import { buildBodyRigTraits } from './rig-traits'

const free = { pelvis: 0, hips: 0, torso: 0, head: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 }
const owned = { pelvis: 1, hips: 1, torso: 1, head: 1, leftArm: 1, rightArm: 1, leftFingers: 1, rightFingers: 1 }

function performerOf(fixture: ReturnType<typeof bodyFixture>) {
  const { mmd, rig } = fixture
  const { skeleton, bindMatrix } = mmd.mesh
  const traits = buildBodyRigTraits(mmd.pmx, rig, [], { boneInverses: skeleton.boneInverses, bindMatrix })
  if (!traits)
    throw new TypeError('The fixture rig must yield body traits')
  return { traits, performer: new MMDBodyPerformer(new MMDBodyPose(mmd, rig), traits, { seed: 1, onEvent: () => {} }) }
}

const zero = { yaw: 0, pitch: 0, roll: 0 }
const stillInput: BodyPerformanceInput = {
  head: { attitude: zero, slow: zero, terms: { emphasis: zero, impulse: zero, pet: zero, held: zero, gesture: zero, cue: zero } },
  posture: { amplitude: 0, shiftRate: 0, support: 0 },
  gaze: { yaw: 0, pitch: 0, kind: 'sustained', saccadeSeq: 0, blinkFactor: 1, micro: { yaw: 0, pitch: 0 } },
  breath: { phase: 0, period: 4, scale: 0 },
  voice: { speaking: false, level: 0, slow: 0, onsetSeq: 0, emphasis: null },
  mood: { valence: 0, arousal: 0, tension: 0 },
  energy: { level: 0.5, mode: 'idle', away: false, reactingUntil: 0 },
  held: { emotion: null, strength: 0, level: 0, side: 1 },
  events: { impulse: null, gesture: null, cue: null, poke: null, pet: { level: 0, active: false, x: 0, y: 0 }, react: null },
  directive: { stance: 'stand', rest: 'none', act: null },
  facingYaw: 0,
  allowTurn: false,
  dragging: false,
  attention: { approach: 0, cursorShare: 0 },
  rootVelocity: { x: 0, y: 0, z: 0 },
  owned: { root: 0, leftLegIk: 0, rightLegIk: 0, lowerBody: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0, upperBody: 0, head: 0 },
  gait: null,
  armLift: { left: 0, right: 0 },
}

function channels(values: Partial<Record<typeof BODY_CHANNELS[number], number>>): Float32Array {
  const out = new Float32Array(BODY_CHANNELS.length)
  for (const [name, value] of Object.entries(values) as [typeof BODY_CHANNELS[number], number][])
    out[channelIndex(name)] = value
  return out
}

describe('mmd body performer adapter', () => {
  it.each([1, 2, 3, 4] as const)('keeps the total torso rotation on a spine chain of %i bones', (spine) => {
    const fixture = bodyFixture(0, Math.PI, { spine })
    expect(fixture.rig.spineChain).toHaveLength(spine)
    const { performer } = performerOf(fixture)
    performer.applyTorso(fixture.pipeline.clean, free, channels({ lowerYaw: 0.1, midYaw: 0.2, upperYaw: 0.3 }))
    const top = fixture.bone(fixture.rig.spineChain[spine - 1].name)
    fixture.mesh.updateMatrixWorld(true)
    // Yaw about one axis commutes, so the composed chain turns by the sum of the three controls.
    const expected = new Quaternion().setFromEuler(new Euler(0, 0.6, 0, 'YXZ'))
    expect(top.getWorldQuaternion(new Quaternion()).angleTo(expected)).toBeLessThan(1e-6)
  })

  it('poses the arm segments where the performer\'s own forward kinematics put them', () => {
    const fixture = bodyFixture()
    const { performer, traits } = performerOf(fixture)
    const pose = channels({ leftClavElev: 0.1, leftClavProt: 0.05, leftFlex: 0.4, leftAbduct: 0.3, leftTwist: 0.2, leftElbow: 0.7, rightFlex: -0.2, rightAbduct: 0.5, rightElbow: 0.3, rightTwist: -0.1 })
    performer.applyArms(fixture.pipeline.clean, free, pose)
    fixture.mesh.updateMatrixWorld(true)
    const skeleton = new BodySkeleton(traits)
    skeleton.update(pose)
    for (const [side, prefix] of [['left', '左'], ['right', '右']] as const) {
      const canonical = skeleton.arm(side, pose)
      for (const [bone, point] of [[`${prefix}ひじ`, canonical.elbow], [`${prefix}手首`, canonical.wrist]] as const) {
        const actual = fixture.bone(bone).getWorldPosition(new Vector3())
        expect(actual.distanceTo(new Vector3(point.x, point.y, point.z))).toBeLessThan(1e-4)
      }
    }
  })

  it('leaves every group at the clean pose when a clip owns it fully', () => {
    const fixture = bodyFixture()
    const { performer } = performerOf(fixture)
    const { clean } = fixture.pipeline
    clean.quaternions.forEach((quaternion, index) => quaternion.setFromEuler(new Euler(0.01 * index, -0.02 * index, 0.015 * index)))
    fixture.bones.forEach((bone, index) => bone.quaternion.copy(clean.quaternions[index]))
    const pose = channels({ pelvisX: 0.02, hipsYaw: 0.1, lowerPitch: 0.2, midRoll: 0.1, upperYaw: 0.2, neckYaw: 0.3, headPitch: 0.2, leftFlex: 0.5, leftElbow: 0.6, leftIndex0: 0.4, rightAbduct: 0.4, rightThumb1: 0.3 })
    performer.applyTorso(clean, owned, pose)
    performer.applyHead(clean, 1, pose)
    performer.applyArms(clean, owned, pose)
    fixture.bones.forEach((bone, index) => {
      expect(1 - Math.abs(bone.quaternion.dot(clean.quaternions[index]))).toBeLessThan(1e-12)
      expect(bone.position.distanceTo(clean.positions[index])).toBeLessThan(1e-9)
    })
  })

  it('raises layer markers from the core reports, each stroke on the tick that reaches its planned hit', () => {
    const fixture = bodyFixture()
    const { traits } = performerOf(fixture)
    const events: { tick: number, event: MMDBodyEvent }[] = []
    let tick = 0
    const empty = new Float64Array(BODY_CHANNELS.length)
    // Tick 2 starts unit 1 and plans a right-hand beat to hit at tick 6; tick 8 returns to rest; tick 3 reports a nod,
    // an emotion onset and a poke flinch.
    const output = (t: number): LayerOutput => {
      const gesture: BodyGestureReport = t < 2
        ? { unitSeq: 0, strokeSeq: 0, form: null, hand: null, phase: 'rest', plannedHit: null }
        : t < 8
          ? { unitSeq: 1, strokeSeq: 1, form: 'beat', hand: 'right', phase: 'stroke', plannedHit: 6 * BODY_TICK }
          : { unitSeq: 1, strokeSeq: 1, form: null, hand: null, phase: 'rest', plannedHit: null }
      return t < 3
        ? { channels: empty, weight: 0, sequence: 0, gesture }
        : { channels: empty, weight: 0, sequence: 0, gesture, cue: { seq: 1, kind: 'nod' }, emotion: { seq: 1, emotion: 'happy', phase: 'onset' }, reaction: { seq: 1, kind: 'body-poke' } }
    }
    const layer: PerformanceLayer = { id: 'reports', order: 'gesture', mode: 'additive', mask: empty, step: context => output(context.tick), reset() {} }
    const performer = new MMDBodyPerformer(new MMDBodyPose(fixture.mmd, fixture.rig), traits, { seed: 1, layers: [layer], onEvent: event => events.push({ tick, event }) })
    for (tick = 1; tick <= 10; tick++)
      performer.step(stillInput)
    expect(events).toEqual([
      { tick: 2, event: { kind: 'gesture-unit', phase: 'start', unitSeq: 1 } },
      { tick: 3, event: { kind: 'cue', cue: 'nod', seq: 1 } },
      { tick: 3, event: { kind: 'emotion-posture', emotion: 'happy', phase: 'onset' } },
      { tick: 3, event: { kind: 'reaction', reaction: 'body-poke' } },
      { tick: 6, event: { kind: 'gesture-stroke', form: 'beat', hand: 'right', unitSeq: 1 } },
      { tick: 8, event: { kind: 'gesture-unit', phase: 'end', unitSeq: 1 } },
    ])
  })

  it('reports a write deviation of 0 for a fully owned group and the written angle for a free one', () => {
    const fixture = bodyFixture()
    const { performer } = performerOf(fixture)
    const pose = channels({ rightFlex: 0.4, rightElbow: 0.5, leftFlex: 0.4, leftElbow: 0.5 })
    performer.beginFrame()
    performer.applyArms(fixture.pipeline.clean, { ...free, rightArm: 1, rightFingers: 1 }, pose)
    expect(performer.writeDeviation.rightArm).toBe(0)
    expect(performer.writeDeviation.leftArm).toBeGreaterThan(0.3)
    performer.beginFrame()
    expect(performer.writeDeviation.leftArm).toBe(0)
  })

  it('never writes a physics-owned bone', () => {
    const { mmd, pipeline, rig, input, bone } = bodyFixture()
    const physics = ['上半身2', '首', '左腕', '左ひじ', '右人指１']
    rig.physicsOwned.push(...physics)
    const body = new MMDBody(mmd, rig, { modelKey: 'physics', input: () => ({ ...input, ...cursorAt(input.intent, new Vector3(20, 18, 10)) }) })
    pipeline.poseStages.splice(0, pipeline.poseStages.length, { id: 'natural', run: () => {} }, ...body.poseStages)
    pipeline.surfaceStages.splice(0, pipeline.surfaceStages.length, body.surfaceStage)
    const index = (name: string) => mmd.mesh.skeleton.bones.indexOf(bone(name))
    for (let frame = 0; frame < 120; frame++) {
      pipeline.step(1 / 60)
      // The pipeline restores the clean pose before the stages; a bone no stage writes still holds it after them.
      for (const name of physics)
        expect(bone(name).quaternion.angleTo(pipeline.clean.quaternions[index(name)])).toBeLessThan(1e-7)
    }
    expect(bone('右腕').quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.1)
  })
})
