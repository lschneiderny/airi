import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'

import { MMDArmRest } from './arms'
import { bodyFixture } from './fixture'
import { MMDBodyPose } from './pose'

const owned = { leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 }
const identityKey = [0, 0, 0, 1]

function armClip(name: string, bone: string, angle: number) {
  const bend = new Quaternion().setFromEuler(new Euler(0, 0, angle)).toArray()
  return new AnimationClip(name, 2, [new QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, [0, 1, 2], [...identityKey, ...bend, ...identityKey])])
}

function play(fixture: ReturnType<typeof bodyFixture>, clip: AnimationClip, registerWithBody = true) {
  fixture.pipeline.registerClip(clip.name, clip)
  if (registerWithBody)
    fixture.body.registerClip(clip.name, clip)
  fixture.pipeline.enqueue(() => fixture.mixer.clipAction(clip).play())
}

describe('mmd arm rest stage', () => {
  it('turns the bind A-pose forearm into the design-note direction through the adapter Euler order', () => {
    const { mmd, rig, pipeline, bone, mesh } = bodyFixture(0, Math.PI, { arms: true })
    expect(rig.restArmAngles.left).toBeCloseTo(0.2 * Math.PI, 6)
    expect(rig.restForearmAngles.right).toBeCloseTo(0.2 * Math.PI, 6)
    const arms = new MMDArmRest(new MMDBodyPose(mmd, rig), { kinematic: [], dynamic: [] })
    arms.apply(pipeline.clean, { dt: 1 / 60, breath: 0, torsoRoll: 0, swing: undefined, swingWeight: 0, owned, hangDeg: null })
    mesh.updateMatrixWorld(true)
    const direction = (elbow: string, wrist: string) => bone(wrist).getWorldPosition(new Vector3()).sub(bone(elbow).getWorldPosition(new Vector3())).normalize()
    const left = direction('左ひじ', '左手首')
    const right = direction('右ひじ', '右手首')
    for (const [actual, expected] of [[left, [0.2034, -0.9399, 0.2741]], [right, [-0.2034, -0.9399, 0.2741]]] as const) {
      expect(actual.x).toBeCloseTo(expected[0], 3)
      expect(actual.y).toBeCloseTo(expected[1], 3)
      expect(actual.z).toBeCloseTo(expected[2], 3)
    }
  })

  it('curls the present fingers, skipping bones the model lacks', () => {
    const { mmd, rig, pipeline, bone } = bodyFixture(0, Math.PI, { arms: true })
    expect(rig.fingerBones.leftThumbMetacarpal).toBe('左親指０')
    expect(rig.fingerBones.leftIndexMetacarpal).toBe('左人指０')
    const arms = new MMDArmRest(new MMDBodyPose(mmd, rig), { kinematic: [], dynamic: [] })
    arms.apply(pipeline.clean, { dt: 1 / 60, breath: 0, torsoRoll: 0, swing: undefined, swingWeight: 0, owned, hangDeg: null })
    expect(bone('左人指１').quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.1)
    expect(bone('左親指０').quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.05)
    expect(bone('左人指０').quaternion.angleTo(new Quaternion())).toBe(0)
  })

  it('hangs the arms clear of the torso, hips and skirt while standing', () => {
    const { pipeline, body } = bodyFixture(0, Math.PI, { arms: true, bodies: true })
    for (let frame = 0; frame < 120; frame++)
      pipeline.step(1 / 60)
    expect(body.diagnostics.arms).toEqual({ weight: 1, owned, penetration: { left: 0, right: 0 }, clothContact: { left: 0, right: 0 }, hangDeg: 78, handBelowHip: true })
  })

  it('reports penetration when the arms hang straight into the hip body at 90 degrees, and lifts the hands at 20 degrees', () => {
    const { pipeline, body, setInput } = bodyFixture(0, Math.PI, { arms: true, bodies: true })
    setInput({ armRestHangDeg: 90 })
    for (let frame = 0; frame < 30; frame++)
      pipeline.step(1 / 60)
    expect(body.diagnostics.arms?.penetration.left).toBeGreaterThan(0)
    expect(body.diagnostics.arms?.penetration.right).toBeGreaterThan(0)
    setInput({ armRestHangDeg: 20 })
    for (let frame = 0; frame < 30; frame++)
      pipeline.step(1 / 60)
    expect(body.diagnostics.arms?.handBelowHip).toBe(false)
  })

  it('ignores a body around the shoulder joint, which every arm starts inside', () => {
    const shoulder = { name: 'shoulder-shell', bone: '上半身2', position: [1.5, 16, 0] as [number, number, number], radius: 0.5, collisionMask: 65535 }
    const { pipeline, body } = bodyFixture(0, Math.PI, { arms: true, bodies: true, extraBodies: [shoulder, { ...shoulder, name: 'right-shoulder-shell', position: [-1.5, 16, 0] }] })
    for (let frame = 0; frame < 60; frame++)
      pipeline.step(1 / 60)
    expect(body.diagnostics.arms?.penetration).toEqual({ left: 0, right: 0 })
  })

  it('counts a kinematic body on the arm path whatever its collision mask, and skips a shell wider than the shoulder span', () => {
    const path = (collisionMask: number, radius: number) => {
      const { pipeline, body } = bodyFixture(0, Math.PI, { arms: true, bodies: true, extraBodies: [{ name: 'on-the-arm', bone: '上半身2', position: [1.9, 13.8, 0], radius, collisionMask }] })
      for (let frame = 0; frame < 60; frame++)
        pipeline.step(1 / 60)
      return body.diagnostics.arms?.penetration.left ?? Number.NaN
    }
    expect(path(65535, 0.6)).toBeGreaterThan(0.1)
    // A group-0 body with self-collision off, like a real rig's own torso, still gates the arm.
    expect(path(0xFF02, 0.6)).toBeGreaterThan(0.1)
    // Wider than 0.65 of the 3-unit shoulder span: a coat shell, ignored.
    expect(path(65535, 2.1)).toBe(0)
  })

  it('reports a dynamic cloth body on the arm path as clothContact and never as penetration', () => {
    const cloth = { name: 'cloth-on-the-arm', bone: '上半身2', position: [1.9, 13.8, 0] as [number, number, number], radius: 0.6, collisionMask: 65535, dynamic: true }
    const { pipeline, body } = bodyFixture(0, Math.PI, { arms: true, bodies: true, extraBodies: [cloth] })
    for (let frame = 0; frame < 60; frame++)
      pipeline.step(1 / 60)
    expect(body.diagnostics.arms?.penetration).toEqual({ left: 0, right: 0 })
    expect(body.diagnostics.arms?.clothContact.left).toBeGreaterThan(0)
    expect(body.diagnostics.arms?.hangDeg).toBe(78)
  })

  it('lifts the arm in 2 degree steps after the warm-up, once the clearance to a kinematic body is violated, and settles', () => {
    const post = { name: 'post', bone: '上半身2', position: [2.2, 12, 0] as [number, number, number], radius: 0.3, collisionMask: 65535 }
    const hangs: number[] = []
    const { pipeline, body } = bodyFixture(0, Math.PI, { arms: true, bodies: true, extraBodies: [post] })
    for (let frame = 0; frame < 300; frame++) {
      pipeline.step(1 / 60)
      hangs.push(body.diagnostics.arms?.hangDeg ?? Number.NaN)
    }
    expect(hangs.slice(0, 60).every(hang => hang === 78)).toBe(true)
    expect(hangs.at(-1)).toBeLessThan(78)
    expect(hangs.at(-1)).toBeGreaterThanOrEqual(60)
    expect(hangs.every((hang, index) => index === 0 || [0, -2].includes(hang - hangs[index - 1]))).toBe(true)
    expect(hangs.slice(-60).every(hang => hang === hangs.at(-1))).toBe(true)
    expect(body.diagnostics.arms?.penetration).toEqual({ left: 0, right: 0 })
  })

  it('does not lift the arm for a body that stays clear of it', () => {
    const { pipeline, body } = bodyFixture(0, Math.PI, { arms: true, bodies: true })
    for (let frame = 0; frame < 300; frame++)
      pipeline.step(1 / 60)
    expect(body.diagnostics.arms?.hangDeg).toBe(78)
  })

  it('never lifts the arm below 60 degrees, however long the overlap lasts', () => {
    const wall = { name: 'wall', bone: '上半身2', position: [2.6, 11, 0] as [number, number, number], radius: 1.9, collisionMask: 65535 }
    const { pipeline, body } = bodyFixture(0, Math.PI, { arms: true, bodies: true, extraBodies: [wall] })
    for (let frame = 0; frame < 400; frame++)
      pipeline.step(1 / 60)
    expect(body.diagnostics.arms?.hangDeg).toBe(60)
  })

  it('does not solve a hang while the debug override is set', () => {
    const post = { name: 'post', bone: '上半身2', position: [2.2, 12, 0] as [number, number, number], radius: 0.3, collisionMask: 65535 }
    const { pipeline, body, setInput } = bodyFixture(0, Math.PI, { arms: true, bodies: true, extraBodies: [post] })
    setInput({ armRestHangDeg: 78 })
    for (let frame = 0; frame < 120; frame++)
      pipeline.step(1 / 60)
    expect(body.diagnostics.arms?.hangDeg).toBe(78)
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
      fixture.body.setLocomotionGoal({ goalX: 4, pace: 'walk', arriveFacing: 0, reason: 'debug' })
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
