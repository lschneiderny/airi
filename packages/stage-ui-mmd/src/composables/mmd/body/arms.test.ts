import type { IdleBehaviourKind, IdleBehaviourRecord } from '@proj-airi/motion-driver-natural/idle-activities'

import type { FixtureShell } from './fixture'

import { WALK_URGENCY } from '@proj-airi/motion-driver-humanoid/types'
import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'

import { bodyFixture } from './fixture'

const owned = { leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 }
const identityKey = [0, 0, 0, 1]
const degrees = Math.PI / 180
/** The fixture's bind arms hang 36 degrees below horizontal. */
const bindHang = 36

function armClip(name: string, bone: string, angle: number) {
  const bend = new Quaternion().setFromEuler(new Euler(0, 0, angle)).toArray()
  return new AnimationClip(name, 2, [new QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, [0, 1, 2], [...identityKey, ...bend, ...identityKey])])
}

/** Holds both upper arms `hangDeg` below horizontal; a clip that owns the arms is never corrected by the performer. */
function hangClip(name: string, hangDeg: number) {
  const key = (sigma: number) => new Quaternion().setFromEuler(new Euler(0, 0, sigma * (bindHang - hangDeg) * degrees)).toArray()
  return new AnimationClip(name, 10, [
    new QuaternionKeyframeTrack('.bones[左腕].quaternion', [0, 10], [...key(1), ...key(1)]),
    new QuaternionKeyframeTrack('.bones[右腕].quaternion', [0, 10], [...key(-1), ...key(-1)]),
  ])
}

/** A rigid jacket around the waist, 1.9 to each side: wider than the default hang clears. */
const jacket: FixtureShell = { bone: '上半身', fromY: 11.6, toY: 13.6, halfWidth: 1.9, halfDepth: 1 }

/** The diagnostics hang of a standing fixture over `frames` frames. */
function hangs(fixture: ReturnType<typeof bodyFixture>, frames: number): number[] {
  const out: number[] = []
  for (let frame = 0; frame < frames; frame++) {
    fixture.pipeline.step(1 / 60)
    out.push(fixture.body.diagnostics.arms?.hangDeg ?? Number.NaN)
  }
  return out
}

function play(fixture: ReturnType<typeof bodyFixture>, clip: AnimationClip, registerWithBody = true) {
  fixture.pipeline.registerClip(clip.name, clip)
  if (registerWithBody)
    fixture.body.registerClip(clip.name, clip)
  fixture.pipeline.enqueue(() => fixture.mixer.clipAction(clip).play())
}

describe('mmd arm measurement and rest clearance', () => {
  it('curls the present fingers, skipping bones the model lacks', () => {
    const { rig, pipeline, bone } = bodyFixture(0, Math.PI, { arms: true })
    expect(rig.fingerBones.leftThumbMetacarpal).toBe('左親指０')
    expect(rig.fingerBones.leftIndexMetacarpal).toBe('左人指０')
    for (let frame = 0; frame < 30; frame++)
      pipeline.step(1 / 60)
    expect(bone('左人指１').quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.1)
    expect(bone('左親指０').quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.05)
    expect(bone('左人指０').quaternion.angleTo(new Quaternion())).toBe(0)
  })

  it('hangs the arms clear of the body model at the default hang while standing', () => {
    const { pipeline, body } = bodyFixture(0, Math.PI, { arms: true, bodies: true, skin: true })
    for (let frame = 0; frame < 120; frame++)
      pipeline.step(1 / 60)
    expect(body.bodyModel?.model.volumes.length).toBeGreaterThan(4)
    expect(body.diagnostics.arms).toMatchObject({ weight: 1, owned, penetration: { left: 0, right: 0 }, headPenetration: { left: 0, right: 0 }, clothContact: { left: 0, right: 0 }, handBelowHip: true })
    expect(body.diagnostics.arms?.hangDeg).toBeCloseTo(78, 9)
  })

  it('reports penetration when a clip hangs the arms straight into the hips, and lifts the hands at a 20 degree hang', () => {
    const fixture = bodyFixture(0, Math.PI, { arms: true, skin: true })
    play(fixture, hangClip('straight-down', 90))
    for (let frame = 0; frame < 30; frame++)
      fixture.pipeline.step(1 / 60)
    expect(fixture.body.diagnostics.arms?.penetration.left).toBeGreaterThan(0)
    expect(fixture.body.diagnostics.arms?.penetration.right).toBeGreaterThan(0)
    const raised = bodyFixture(0, Math.PI, { arms: true, skin: true })
    raised.setInput({ armRestHangDeg: 20 })
    for (let frame = 0; frame < 30; frame++)
      raised.pipeline.step(1 / 60)
    expect(raised.body.diagnostics.arms?.handBelowHip).toBe(false)
    expect(raised.body.diagnostics.arms?.hangDeg).toBeCloseTo(20, 9)
  })

  it('keeps a rigid shell around the shoulders inside the shoulder joints, which every arm starts beside', () => {
    const { pipeline, body } = bodyFixture(0, Math.PI, { arms: true, skin: [{ bone: '上半身2', fromY: 15, toY: 16.4, halfWidth: 2.4, halfDepth: 1 }] })
    for (let frame = 0; frame < 60; frame++)
      pipeline.step(1 / 60)
    expect(body.diagnostics.arms?.penetration).toEqual({ left: 0, right: 0 })
    expect(body.diagnostics.arms?.hangDeg).toBeCloseTo(78, 9)
  })

  it('gates the arm on rigid geometry in its path, and never on a bone-following body the author put on the trunk', () => {
    const path = (skin: FixtureShell[], authored: boolean) => {
      const fixture = bodyFixture(0, Math.PI, { arms: true, skin, bodies: authored, extraBodies: authored ? [{ name: 'on-the-arm', bone: '上半身2', position: [1.9, 13.8, 0], radius: 0.6, collisionMask: 65535 }] : [] })
      // A clip that owns the arms holds them 10 degrees inside the rest the model solved for the jacket, where the
      // performer corrects nothing. The gate measures the jacket as the corrector fitted it to that rest.
      play(fixture, hangClip('inside-the-rest', 82))
      for (let frame = 0; frame < 60; frame++)
        fixture.pipeline.step(1 / 60)
      return fixture.body.diagnostics.arms?.penetration.left ?? Number.NaN
    }
    expect(path([jacket], false)).toBeGreaterThan(0.1)
    expect(path([], true)).toBe(0)
  })

  it('rests the arm where the body model says with rigid geometry round the default rest elbow, and gates on the volumes as the corrector fitted them', () => {
    const bare = bodyFixture(0, Math.PI, { arms: true, skin: true })
    hangs(bare, 60)
    bare.mesh.updateMatrixWorld(true)
    const elbow = bare.mesh.worldToLocal(bare.bone('左ひじ').getWorldPosition(new Vector3()))
    // A tube of rigid mesh round the left elbow of the default hang, which no rest within the model's bound clears.
    const fixture = bodyFixture(0, Math.PI, { arms: true, skin: [{ bone: '上半身2', fromY: elbow.y - 0.3, toY: elbow.y + 0.3, x: elbow.x, halfWidth: 0.3, halfDepth: 0.3 }] })
    const { body } = fixture
    const rest = body.bodyModel?.model.rest
    // The model opens the left rest and shrinks the volume (README rule 6); the right arm keeps the default hang.
    expect(rest?.left.limit?.kind).toBe('volume')
    expect(rest?.left.abduct).toBeGreaterThan(18 * degrees)
    expect(rest?.right).toEqual({ abduct: expect.closeTo(12 * degrees, 9), limit: null })

    hangs(fixture, 60)
    // The arm rests there: no volume holds it away from that rest, and the rest is no penetration.
    expect(body.diagnostics.arms?.penetration).toEqual({ left: 0, right: 0 })
    expect(body.diagnostics.arms?.correctionDeg.left).toBeCloseTo(0, 6)
    expect(body.diagnostics.arms?.hangDeg).toBeCloseTo(90 - ((rest?.left.abduct ?? 0) + (rest?.right.abduct ?? 0)) / 2 / degrees, 9)

    // The gate measures each volume at the corrector's fit to that rest: the seed draws the left hang a little inside
    // the solved one, so the volume it leans on gives way by a few percent, and every other volume keeps its size.
    const whole = body.bodyModel?.colliders ?? []
    expect(body.armVolumes).toHaveLength(whole.length)
    const scales = body.armVolumes.map((volume, index) => volume.size[0] / whole[index].size[0])
    expect(scales.filter(scale => scale !== 1)).toHaveLength(1)
    expect(Math.min(...scales)).toBeGreaterThan(0.9)
    expect(Math.min(...scales)).toBeLessThan(1)
  })

  it('keeps the author\'s head and neck bodies after the model\'s volumes, for the corrector and for the gate\'s head list, as fitted', () => {
    // A skull, and a hair-collision body on the neck that reaches round the upper arm of the rest hang.
    const skull = { name: 'skull', bone: '頭', position: [0, 19, 0] as [number, number, number], radius: 0.7, collisionMask: 65535 }
    const collar = { name: 'collar', bone: '首', position: [0.9, 15.4, 0] as [number, number, number], radius: 1.5, collisionMask: 65535 }
    const fixture = bodyFixture(0, Math.PI, { arms: true, bodies: true, skin: true, extraBodies: [skull, collar] })
    const { body } = fixture
    const volumes = body.bodyModel?.colliders ?? []
    expect(volumes.length).toBeGreaterThan(4)
    expect(body.bodyModel?.model.volumes.some(volume => volume.bone === 'head' || volume.bone === 'neck')).toBe(false)
    // The performer's colliders: the model's volumes, then the two authored bodies on their canonical bones.
    expect(body.traits?.colliders.map(collider => collider.bone).slice(volumes.length)).toEqual(['head', 'neck'])

    // The gate's lists keep that order. The rest hang lies in the collar, so the corrector shrinks it and the gate
    // measures it as shrunk; the skull and every volume of the model keep their size.
    expect(body.armVolumes.slice(0, volumes.length)).toEqual(volumes)
    expect(body.armVolumes[volumes.length]).toMatchObject({ name: 'skull', region: 'head', size: [skull.radius, 0, 0] })
    const fitted = body.armVolumes[volumes.length + 1]
    expect(fitted).toMatchObject({ name: 'collar', region: 'head' })
    expect(fitted.size[0]).toBeGreaterThan(0)
    expect(fitted.size[0]).toBeLessThan(collar.radius)
    expect(body.armVolumes).toHaveLength(volumes.length + 2)

    hangs(fixture, 60)
    expect(body.diagnostics.arms).toMatchObject({ penetration: { left: 0, right: 0 }, headPenetration: { left: 0, right: 0 } })
    expect(body.diagnostics.arms?.hangDeg).toBeCloseTo(78, 9)
    // A clip that owns the arms points them from the shoulders at the skull: the head list reports it.
    play(fixture, hangClip('at-the-skull', -117))
    hangs(fixture, 60)
    expect(body.diagnostics.arms?.headPenetration.left).toBeGreaterThan(0)
    expect(body.diagnostics.arms?.headPenetration.right).toBeGreaterThan(0)
  })

  it('reports a dynamic cloth body on the arm path as clothContact and never as penetration', () => {
    const cloth = { name: 'cloth-on-the-arm', bone: '上半身2', position: [1.9, 13.8, 0] as [number, number, number], radius: 0.6, collisionMask: 65535, dynamic: true }
    const { pipeline, body } = bodyFixture(0, Math.PI, { arms: true, bodies: true, skin: true, extraBodies: [cloth] })
    for (let frame = 0; frame < 60; frame++)
      pipeline.step(1 / 60)
    expect(body.diagnostics.arms?.penetration).toEqual({ left: 0, right: 0 })
    expect(body.diagnostics.arms?.clothContact.left).toBeGreaterThan(0)
    expect(body.diagnostics.arms?.hangDeg).toBeCloseTo(78, 9)
  })

  it('rests the arms at the body model\'s clearance from the first frame, and holds it', () => {
    const fixture = bodyFixture(0, Math.PI, { arms: true, skin: [jacket] })
    const rest = fixture.body.bodyModel?.model.rest
    expect(rest?.left.abduct).toBeGreaterThan(12 * degrees)
    const expected = 90 - ((rest?.left.abduct ?? 0) + (rest?.right.abduct ?? 0)) / 2 / degrees
    const series = hangs(fixture, 300)
    expect(series.every(hang => Math.abs(hang - expected) < 1e-9)).toBe(true)
    expect(fixture.body.diagnostics.arms?.penetration).toEqual({ left: 0, right: 0 })
  })

  it('keeps the default hang on a body that stays clear of the arms', () => {
    expect(hangs(bodyFixture(0, Math.PI, { arms: true, skin: true }), 300).every(hang => Math.abs(hang - 78) < 1e-9)).toBe(true)
  })

  it('keeps the rest hang through an idle behaviour that brings the arms to the body', () => {
    const fixture = bodyFixture(0, Math.PI, { arms: true, skin: [jacket] })
    const [before] = hangs(fixture, 60)
    const record: IdleBehaviourRecord = { seq: 1, kind: 'clasp-hands' as IdleBehaviourKind, intentId: null, start: 0, end: 6, releasedAt: null, releaseSeconds: 0, side: 1, period: 2, tone: 0, count: 2, variant: 0, keys: [], glances: [] }
    fixture.setInput({ intent: { ...fixture.input.intent, idle: { behaviour: record, errand: null, groovePhase: null } } })
    expect(hangs(fixture, 9 * 60).every(hang => hang === before)).toBe(true)
  })

  it('replaces the rest clearance with the debug override on both sides, and restores it', () => {
    const fixture = bodyFixture(0, Math.PI, { arms: true, skin: [jacket] })
    const [solved] = hangs(fixture, 30)
    fixture.setInput({ armRestHangDeg: 78 })
    expect(hangs(fixture, 30).at(-1)).toBeCloseTo(78, 9)
    fixture.setInput({ armRestHangDeg: null })
    expect(hangs(fixture, 30).at(-1)).toBe(solved)
  })

  it('gives a clip ownership only of the groups its keys move', () => {
    const fixture = bodyFixture(0, Math.PI, { arms: true })
    play(fixture, armClip('wave', '左腕', Math.PI / 3))
    play(fixture, armClip('still', '右腕', 0))
    fixture.pipeline.step(1 / 60)
    fixture.pipeline.step(1 / 60)
    expect(fixture.body.ownership()).toMatchObject({ leftArm: 1, rightArm: 0, leftFingers: 0, rightFingers: 0, root: 0, leftLegIk: 0, rightLegIk: 0 })
    expect(fixture.body.diagnostics.arms?.owned).toEqual({ leftArm: 1, rightArm: 0, leftFingers: 0, rightFingers: 0 })
    expect(fixture.body.diagnostics.arms?.weight).toBe(0)
  })

  it('leaves owned arm bones to the clip and relaxes the free ones', () => {
    const fixture = bodyFixture(0, Math.PI, { arms: true })
    play(fixture, armClip('wave', '左腕', Math.PI / 3))
    for (let frame = 0; frame < 30; frame++)
      fixture.pipeline.step(1 / 60)
    const index = (name: string) => fixture.mmd.mesh.skeleton.bones.findIndex(bone => bone.name === name)
    const clean = (name: string) => fixture.pipeline.clean.quaternions[index(name)]
    // Float32 clip keys are not exactly unit length, which makes angleTo amplify noise; compare components instead.
    for (const name of ['左腕', '左肩']) {
      fixture.bone(name).quaternion.toArray().forEach((value, axis) => expect(value).toBeCloseTo(clean(name).toArray()[axis], 6))
    }
    expect(fixture.bone('右腕').quaternion.angleTo(clean('右腕'))).toBeGreaterThan(0.5)
  })

  it('treats a clip the body never saw as owning every group', () => {
    const fixture = bodyFixture(0, Math.PI, { arms: true })
    play(fixture, armClip('unknown', '左腕', Math.PI / 3), false)
    fixture.pipeline.step(1 / 60)
    fixture.pipeline.step(1 / 60)
    const ownership = fixture.body.ownership()
    expect(Object.keys(ownership).sort()).toEqual(['head', 'leftArm', 'leftFingers', 'leftLegIk', 'lowerBody', 'rightArm', 'rightFingers', 'rightLegIk', 'root', 'upperBody'])
    for (const value of Object.values(ownership))
      expect(value).toBe(1)
  })

  it('keeps walking while a clip owns only the arms, and stops for a clip that keys a leg IK bone', () => {
    const walkWith = (clip: AnimationClip) => {
      const fixture = bodyFixture(0, Math.PI, { arms: true })
      fixture.setInput({ rootMotion: true })
      play(fixture, clip)
      for (let frame = 0; frame < 30; frame++)
        fixture.pipeline.step(1 / 60)
      fixture.body.setLocomotionGoal({ goalX: 4, urgency: WALK_URGENCY, arriveFacing: 0, reason: 'debug' })
      for (let frame = 0; frame < 900; frame++)
        fixture.pipeline.step(1 / 60)
      return { enabled: fixture.body.diagnostics.locomotion?.enabled, x: fixture.mesh.position.x, ownership: fixture.body.ownership() }
    }
    const arm = walkWith(armClip('wave', '左腕', Math.PI / 3))
    expect(arm.ownership.leftArm).toBe(1)
    expect(arm.enabled).toBe(true)
    expect(Math.abs(arm.x - 4)).toBeLessThan(1e-2)

    const legClip = new AnimationClip('step', 2, [new VectorKeyframeTrack('.bones[左足ＩＫ].position', [0, 1], [0, 0, 0, 0, 1, 0])])
    const leg = walkWith(legClip)
    expect(leg.ownership.leftLegIk).toBe(1)
    expect(leg.enabled).toBe(false)
    expect(leg.x).toBe(0)
  })
})
