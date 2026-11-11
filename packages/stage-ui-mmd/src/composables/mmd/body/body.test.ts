import type { ClipMaskGroup } from '@proj-airi/motion-driver-humanoid/clip-mask'

import type { LayerEvent } from '../animation-manager'
import type { MMDBodyInput } from './index'

import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'

import { createMMDAnimationManager } from '../animation-manager'
import { mmdClipMaskBones } from '../rig/clip-mask'
import { bodyFixture, cursorAt } from './fixture'
import { MMDBody } from './index'

const FULL_BODY: readonly ClipMaskGroup[] = ['root', 'leftLegIk', 'rightLegIk']

/** A clip that holds one bone at a fixed rotation for `duration` seconds. */
function holdClip(name: string, bone: string, rotation: Euler, duration = 2) {
  const pose = new Quaternion().setFromEuler(rotation).toArray()
  return new AnimationClip(name, duration, [new QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, [0, duration], [...pose, ...pose])])
}

describe('mmd full-body stages', () => {
  it('keeps solved ankles planted through the first weighted sit frame', () => {
    const { pipeline, body, mixer, bone, setInput } = bodyFixture()
    const duration = 2
    const clip = new AnimationClip('sit', duration, [
      new VectorKeyframeTrack('.bones[センター].position', [0, duration], [0, 3.5, 0, 0, 3.5, 0]),
      ...['左', '右'].flatMap((side) => {
        const hip = new Quaternion().setFromEuler(new Euler(-80 * Math.PI / 180, 0, 0)).toArray()
        const knee = new Quaternion().setFromEuler(new Euler(80 * Math.PI / 180, 0, 0)).toArray()
        return [
          new QuaternionKeyframeTrack(`.bones[${side}足].quaternion`, [0, duration], [...hip, ...hip]),
          new QuaternionKeyframeTrack(`.bones[${side}ひざ].quaternion`, [0, duration], [...knee, ...knee]),
        ]
      }),
    ])
    pipeline.registerClip(clip.name, clip)
    body.registerClip(clip.name, clip)
    setInput({ stanceClips: new Set([clip.name]) })
    for (let frame = 0; frame < 120; frame++)
      pipeline.step(1 / 60)
    const ankles = ['左足首', '右足首'].map(name => bone(name).getWorldPosition(new Vector3()))
    pipeline.enqueue(() => mixer.clipAction(clip).reset().fadeIn(0.6).play())
    for (let frame = 0; frame < 90; frame++) {
      pipeline.step(1 / 60)
      expect(body.diagnostics.feet.maxError, `sit frame ${frame}`).toBeLessThan(0.05)
      for (const [index, name] of ['左足首', '右足首'].entries())
        expect(bone(name).getWorldPosition(new Vector3()).distanceTo(ankles[index]), `ankle ${name} frame ${frame}`).toBeLessThan(0.05)
    }
    const steady = ['左足', '右足', '左ひざ', '右ひざ'].map(name => bone(name).getWorldQuaternion(new Quaternion()))
    // At full clip weight the ordinary clip + real IK solve is the reference.
    // Removing the procedural contact stage must not change its bend plane.
    const contactStage = pipeline.poseStages.findIndex(stage => stage.id === 'foot-contact')
    pipeline.poseStages.splice(contactStage, 1)
    pipeline.step(1 / 60)
    for (const [index, name] of ['左足', '右足', '左ひざ', '右ひざ'].entries())
      expect(bone(name).getWorldQuaternion(new Quaternion()).angleTo(steady[index])).toBeLessThan(1e-5)
  })

  it('plants actual ankles through 600 frames of weight shift in a transformed IK parent', () => {
    const { pipeline, body, bone } = bodyFixture()
    const anchors = [new Vector3(1, 1, 0), new Vector3(-1, 1, 0)]
    let sway = 0
    for (let frame = 0; frame < 600; frame++) {
      pipeline.step(1 / 30)
      sway = Math.max(sway, Math.abs(bone('グルーブ').position.x))
      for (const [index, name] of ['左足首', '右足首'].entries())
        expect(bone(name).getWorldPosition(new Vector3()).distanceTo(anchors[index])).toBeLessThan(0.01)
      expect(body.diagnostics.feet.maxError).toBeLessThan(0.01)
    }
    expect(sway).toBeGreaterThan(0.3)
  })

  it('honors positive post-parse knee limits while lateral sway changes each frame', () => {
    const { pipeline, bone, setInput, input } = bodyFixture()
    for (let frame = 0; frame < 600; frame++) {
      setInput({ frame: { ...input.frame, pose: { ...input.frame.pose, bodyZ: Math.sin(frame / 12) } } })
      pipeline.step(1 / 30)
      for (const name of ['左ひざ', '右ひざ']) {
        const rotation = new Euler().setFromQuaternion(bone(name).quaternion, 'ZYX')
        expect(rotation.x).toBeGreaterThanOrEqual(0.0087 - 1e-6)
        expect(rotation.x).toBeLessThanOrEqual(Math.PI)
        expect(Math.abs(rotation.y)).toBeLessThan(1e-6)
        expect(Math.abs(rotation.z)).toBeLessThan(1e-6)
      }
    }
  })

  it('honors a saturated knee clip limit through real IK after updateAnimation', () => {
    const { pipeline, body, mixer, bone } = bodyFixture(0, 0.4)
    const bend = new Quaternion().setFromEuler(new Euler(1.8, 0, 0))
    const clip = new AnimationClip('knee', 10, [
      new QuaternionKeyframeTrack('.bones[左ひざ].quaternion', [0, 10], [...bend.toArray(), ...bend.toArray()]),
    ])
    pipeline.registerClip(clip.name, clip)
    body.registerClip(clip.name, clip)
    pipeline.enqueue(() => mixer.clipAction(clip).setEffectiveWeight(0.5).play())
    for (let frame = 0; frame < 120; frame++) {
      pipeline.step(1 / 30)
      expect(new Euler().setFromQuaternion(bone('左ひざ').quaternion, 'ZYX').x).toBeLessThanOrEqual(0.4 + 1e-6)
    }
  })

  it('aims both eye rays within half a degree after the whole look-at chain', () => {
    const { pipeline, bone, setInput, input } = bodyFixture()
    const target = new Vector3(4, 21, 30)
    setInput(cursorAt(input.intent, target))
    for (let frame = 0; frame < 180; frame++)
      pipeline.step(1 / 60)
    for (const name of ['左目', '右目']) {
      const eye = bone(name)
      const ray = new Vector3(0, 0, 1).applyQuaternion(eye.getWorldQuaternion(new Quaternion()))
      const direction = target.clone().sub(eye.getWorldPosition(new Vector3()))
      expect(ray.angleTo(direction)).toBeLessThan(Math.PI / 360)
      expect(ray.x).toBeGreaterThan(0)
      expect(ray.y).toBeGreaterThan(0)
    }
  })

  it('aims at the cursor or the chat point only while Natural looks at it', () => {
    const look = (on: MMDBodyInput['intent']['gaze']['on']) => {
      const { pipeline, body, bone, input, setInput } = bodyFixture()
      setInput({
        intent: { ...input.intent, gaze: { ...input.intent.gaze, on } },
        points: { cursor: new Vector3(20, 21, 30), chat: new Vector3(-20, 21, 30), camera: new Vector3(0, 21, 40) },
      })
      for (let frame = 0; frame < 180; frame++)
        pipeline.step(1 / 60)
      const facing = new Vector3(0, 0, 1).applyQuaternion(bone('頭').getWorldQuaternion(new Quaternion()))
      return { yaw: Math.atan2(facing.x, facing.z) * 180 / Math.PI, kind: body.diagnostics.performance?.gaze.kind }
    }
    const cursor = look('cursor')
    const chat = look('chat')
    const away = look('free')
    expect(cursor.kind).toBe('sustained')
    expect(cursor.yaw).toBeGreaterThan(10)
    expect(chat.kind).toBe('sustained')
    expect(chat.yaw).toBeLessThan(-10)
    expect(away.kind).toBe('free')
    expect(Math.abs(away.yaw)).toBeLessThan(3)
  })

  it('keeps solved feet on the stepping arcs during alternating body turns', () => {
    const { pipeline, body, setInput, input } = bodyFixture()
    let lift = 0
    for (let frame = 0; frame < 600; frame++) {
      setInput(cursorAt(input.intent, new Vector3(frame < 300 ? -30 : 30, 18, 2)))
      pipeline.step(1 / 30)
      if (frame >= 10)
        expect(body.diagnostics.feet.maxError).toBeLessThan(0.01)
      lift = Math.max(lift, body.diagnostics.lookAt.turns)
    }
    expect(lift).toBeGreaterThanOrEqual(2)
  })

  it('resolves eye signs from rotated bind axes instead of flipping parsed Z again', () => {
    const { pipeline, bone, setInput, input } = bodyFixture(Math.PI)
    const target = new Vector3(-3, 20, 30)
    setInput(cursorAt(input.intent, target))
    for (let frame = 0; frame < 180; frame++)
      pipeline.step(1 / 60)
    for (const name of ['左目', '右目']) {
      const eye = bone(name)
      const ray = new Vector3(0, 0, -1).applyQuaternion(eye.getWorldQuaternion(new Quaternion()))
      expect(ray.angleTo(target.clone().sub(eye.getWorldPosition(new Vector3())))).toBeLessThan(Math.PI / 360)
      expect(ray.x).toBeLessThan(0)
    }
  })

  it('clamps both eye axes under saturated, alternating unreachable targets', () => {
    const { pipeline, bone, setInput, input } = bodyFixture()
    for (let frame = 0; frame < 120; frame++) {
      const sign = frame < 60 || frame % 2 === 0 ? 1 : -1
      setInput(cursorAt(input.intent, new Vector3(sign * (100 + frame), sign * 150, 0)))
      pipeline.step(1 / 60)
      for (const name of ['左目', '右目']) {
        const rotation = new Euler().setFromQuaternion(bone(name).quaternion, 'YXZ')
        expect(Math.abs(rotation.y)).toBeLessThanOrEqual(0.35 + 1e-6)
        expect(Math.abs(rotation.x)).toBeLessThanOrEqual(0.25 + 1e-6)
      }
    }
  })

  it('does not compound body overlays when the same clean pose is reapplied', () => {
    const { pipeline, body, bones, mmd, mixer } = bodyFixture()
    for (let frame = 0; frame < 400; frame++)
      pipeline.step(1 / 30)
    const context = { clean: pipeline.clean, dt: 0, mmd, mixer }
    for (const stage of body.poseStages)
      stage.run(context)
    const first = bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() }))
    for (let frame = 0; frame < 1000; frame++) {
      for (const stage of body.poseStages)
        stage.run(context)
      bones.forEach((bone, index) => {
        expect(bone.position.distanceTo(first[index].position)).toBeLessThan(1e-8)
        expect(1 - Math.abs(bone.quaternion.dot(first[index].quaternion))).toBeLessThan(1e-10)
      })
    }
  })

  it('reports skating when contact is disabled and resumes contact when reenabled', () => {
    const { pipeline, body, setInput } = bodyFixture()
    for (let frame = 0; frame < 30; frame++)
      pipeline.step(1 / 30)
    setInput({ disableFootContact: true })
    let error = 0
    for (let frame = 0; frame < 600; frame++) {
      pipeline.step(1 / 30)
      error = Math.max(error, body.diagnostics.feet.maxError)
    }
    expect(error).toBeGreaterThan(0.2)
    setInput({ disableFootContact: false })
    for (let frame = 0; frame < 60; frame++)
      pipeline.step(1 / 30)
    expect(body.diagnostics.feet.maxError).toBeLessThan(0.01)
  })

  it('disables the look-at chain and restores it on the next enabled frames', () => {
    const { pipeline, body, bone, setInput, input } = bodyFixture()
    setInput(cursorAt(input.intent, new Vector3(10, 20, 30)))
    for (let frame = 0; frame < 120; frame++)
      pipeline.step(1 / 60)
    expect(bone('頭').quaternion.y).toBeGreaterThan(0.04)
    setInput({ disableLookAt: true })
    pipeline.step(1 / 60)
    expect(body.diagnostics.lookAt.target).toBeNull()
    expect(bone('頭').quaternion.angleTo(new Quaternion())).toBeLessThan(1e-7)
    setInput({ disableLookAt: false })
    for (let frame = 0; frame < 120; frame++)
      pipeline.step(1 / 60)
    expect(bone('頭').quaternion.y).toBeGreaterThan(0.04)
  })

  it('retains stepped anchors when contact is briefly interrupted during a turn', () => {
    const { pipeline, body, setInput, bone, input } = bodyFixture()
    setInput(cursorAt(input.intent, new Vector3(-30, 18, 2)))
    for (let frame = 0; frame < 180; frame++)
      pipeline.step(1 / 60)
    const before = bone('左足首').getWorldPosition(new Vector3())
    setInput({ disableFootContact: true })
    pipeline.step(1 / 60)
    setInput({ disableFootContact: false })
    for (let frame = 0; frame < 60; frame++)
      pipeline.step(1 / 60)
    expect(bone('左足首').getWorldPosition(new Vector3()).distanceTo(before)).toBeLessThan(0.01)
    expect(body.diagnostics.feet.maxError).toBeLessThan(0.01)
  })

  it('ducks all procedural writes under a fully weighted clip', () => {
    const { pipeline, mixer, bone, setInput, input } = bodyFixture()
    const rotation = new Quaternion().setFromEuler(new Euler(0.1, 0.2, 0))
    const clip = new AnimationClip('one-shot', 1, [
      new QuaternionKeyframeTrack('.bones[頭].quaternion', [0, 1], [...rotation.toArray(), ...rotation.toArray()]),
    ])
    pipeline.registerClip(clip.name, clip)
    pipeline.enqueue(() => mixer.clipAction(clip).play())
    setInput(cursorAt(input.intent, new Vector3(10, 22, 20)))
    for (let frame = 0; frame < 60; frame++)
      pipeline.step(1 / 30)
    expect(bone('頭').quaternion.clone().normalize().angleTo(rotation)).toBeLessThan(1e-6)
    expect(bone('グルーブ').position.length()).toBeLessThan(1e-6)
    expect(bone('左目').quaternion.angleTo(new Quaternion())).toBeLessThan(1e-6)
  })

  it('keeps half of the head look-at under a fully weighted stance clip while ducking the body', () => {
    const headAngle = (clipped: boolean, stanceClips: ReadonlySet<string>) => {
      const { pipeline, mixer, bone, setInput, input } = bodyFixture()
      if (clipped) {
        const clip = new AnimationClip('sit', 1, [new VectorKeyframeTrack('.bones[センター].position', [0, 1], [0, 10, 0, 0, 10, 0])])
        pipeline.registerClip(clip.name, clip)
        pipeline.enqueue(() => mixer.clipAction(clip).play())
      }
      let groove = 0
      for (let frame = 0; frame < 240; frame++) {
        setInput({ ...cursorAt(input.intent, new Vector3(Math.sin(frame / 20) * 12 + 14, 22, 20)), stanceClips })
        pipeline.step(1 / 30)
        groove = Math.max(groove, bone('グルーブ').position.length())
      }
      return { head: bone('頭').quaternion.angleTo(new Quaternion()), groove }
    }
    const free = headAngle(false, new Set())
    const stance = headAngle(true, new Set(['sit']))
    const oneShot = headAngle(true, new Set())
    expect(free.head).toBeGreaterThan(0.05)
    expect(stance.head / free.head).toBeGreaterThan(0.4)
    expect(stance.head / free.head).toBeLessThan(0.6)
    expect(stance.groove).toBeLessThan(1e-6)
    expect(oneShot.head).toBeLessThan(1e-6)
  })

  it('tolerates missing leg IK and one missing eye without touching physics bones', () => {
    const { mmd, pipeline, rig, input, bones } = bodyFixture()
    rig.legIk.left = null
    rig.legIk.right = null
    delete rig.bones.leftEye
    rig.physicsOwned.push('頭')
    const body = new MMDBody(mmd, rig, { modelKey: 'partial', input: () => ({ ...input, ...cursorAt(input.intent, new Vector3(3, 20, 30)) }) })
    pipeline.poseStages.splice(0, pipeline.poseStages.length, ...body.poseStages)
    pipeline.surfaceStages.splice(0, pipeline.surfaceStages.length, body.surfaceStage)
    pipeline.step(1 / 30)
    expect(body.diagnostics.feet.contact).toBe(0)
    expect(bones.find(bone => bone.name === '頭')?.quaternion.toArray()).toEqual([0, 0, 0, 1])
    expect(bones.find(bone => bone.name === '左目')?.quaternion.toArray()).toEqual([0, 0, 0, 1])
    expect(bones.find(bone => bone.name === '右目')?.quaternion.y).toBeGreaterThan(0)
  })

  it('walks the root to the goal with world-planted feet and resets physics only on a teleport', () => {
    const { pipeline, body, mmd, mesh, setInput, setRootX } = bodyFixture()
    let resets = 0
    mmd.physics = {
      createHelper: () => { throw new Error('Unused helper') },
      reset: () => {
        resets++
      },
      update: () => {},
    }
    pipeline.options.physics = true
    setInput({ rootMotion: true })
    for (let frame = 0; frame < 30; frame++)
      pipeline.step(1 / 60)
    resets = 0
    body.setLocomotionGoal({ goalX: 10, pace: 'walk', arriveFacing: 0, reason: 'debug' })
    let skate = 0
    let walked = false
    let maxError = 0
    for (let frame = 0; frame < 1200 && (!walked || body.diagnostics.locomotion?.mode !== 'idle'); frame++) {
      pipeline.step(1 / 60)
      const locomotion = body.diagnostics.locomotion
      skate = Math.max(skate, locomotion?.skate ?? Infinity)
      maxError = Math.max(maxError, body.diagnostics.feet.maxError)
      walked ||= locomotion?.mode === 'walking'
      expect(mesh.position.x).toBe(locomotion?.position.x)
    }
    const locomotion = body.diagnostics.locomotion
    expect(walked).toBe(true)
    expect(locomotion?.mode).toBe('idle')
    expect(Math.abs((locomotion?.position.x ?? 0) - 10)).toBeLessThan(1e-2)
    expect(locomotion?.leashClamps).toBe(0)
    expect(skate).toBeLessThan(0.01)
    expect(maxError).toBeLessThan(0.05)
    expect(body.locomotionFrame?.feet.left.planted).toBe(true)
    expect(body.locomotionFrame?.feet.right.planted).toBe(true)
    expect(body.diagnostics.feet.contact).toBe(1)
    expect(body.diagnostics.feet.maxError).toBeLessThan(0.01)
    expect(resets).toBe(0)

    setRootX(3, { teleport: true })
    pipeline.step(1 / 60)
    expect(resets).toBe(1)
    expect(body.diagnostics.locomotion?.position.x).toBe(3)
  })

  it('keeps a drag: a pending goal never pulls the root back and both feet re-plant beside it', () => {
    const { pipeline, body, mesh, bone, setInput, setRootX } = bodyFixture()
    setInput({ rootMotion: true })
    for (let frame = 0; frame < 30; frame++)
      pipeline.step(1 / 60)
    body.setLocomotionGoal({ goalX: 10, pace: 'walk', arriveFacing: 0, reason: 'debug' })
    for (let frame = 0; frame < 20; frame++)
      pipeline.step(1 / 60)
    expect(body.diagnostics.locomotion?.mode).not.toBe('idle')
    setRootX(6, { teleport: false })
    for (let frame = 0; frame < 120; frame++) {
      pipeline.step(1 / 60)
      expect(Math.abs(mesh.position.x - 6)).toBeLessThan(1e-3)
      expect(Math.abs((body.diagnostics.locomotion?.position.x ?? 0) - 6)).toBeLessThan(1e-3)
    }
    expect(body.diagnostics.locomotion?.mode).toBe('idle')
    expect(body.diagnostics.locomotion?.goalX).toBeNull()
    for (const [name, x] of [['左足首', 1], ['右足首', -1]] as const) {
      const beside = mesh.localToWorld(new Vector3(x, 1, 0))
      expect(bone(name).getWorldPosition(new Vector3()).distanceTo(beside)).toBeLessThan(0.01)
    }
  })

  it('ignores a goal while a stance clip plays', () => {
    const { pipeline, mixer, body, mesh, setInput } = bodyFixture()
    const clip = new AnimationClip('sit', 1, [new VectorKeyframeTrack('.bones[センター].position', [0, 1], [0, 8, 0, 0, 8, 0])])
    pipeline.registerClip(clip.name, clip)
    body.registerClip(clip.name, clip)
    pipeline.enqueue(() => mixer.clipAction(clip).play())
    setInput({ rootMotion: true, stanceClips: new Set(['sit']) })
    for (let frame = 0; frame < 30; frame++)
      pipeline.step(1 / 60)
    body.setLocomotionGoal({ goalX: 10, pace: 'walk', arriveFacing: 0, reason: 'debug' })
    for (let frame = 0; frame < 120; frame++) {
      pipeline.step(1 / 60)
      expect(body.diagnostics.locomotion).toMatchObject({ mode: 'idle', enabled: false, goalX: null })
      expect(mesh.position.x).toBe(0)
    }
  })

  it('keeps foot contact and the gait while an arm-only clip plays through a walk', () => {
    const { pipeline, body, mixer, setInput } = bodyFixture(0, Math.PI, { arms: true })
    const wave = holdClip('arms-wave', '左腕', new Euler(0, 0, -Math.PI / 3))
    pipeline.registerClip(wave.name, wave)
    body.registerClip(wave.name, wave)
    pipeline.enqueue(() => mixer.clipAction(wave).play())
    setInput({ rootMotion: true })
    for (let frame = 0; frame < 30; frame++)
      pipeline.step(1 / 60)
    expect(body.ownership()).toMatchObject({ leftArm: 1, root: 0, leftLegIk: 0, rightLegIk: 0, lowerBody: 0, upperBody: 0 })
    body.setLocomotionGoal({ goalX: 10, pace: 'walk', arriveFacing: 0, reason: 'debug' })
    let skate = 0
    let maxError = 0
    let walked = false
    for (let frame = 0; frame < 1200 && (!walked || body.diagnostics.locomotion?.mode !== 'idle'); frame++) {
      pipeline.step(1 / 60)
      const locomotion = body.diagnostics.locomotion
      expect(locomotion?.enabled).toBe(true)
      skate = Math.max(skate, locomotion?.skate ?? Infinity)
      maxError = Math.max(maxError, body.diagnostics.feet.maxError)
      walked ||= locomotion?.mode === 'walking'
    }
    expect(walked).toBe(true)
    expect(Math.abs((body.diagnostics.locomotion?.position.x ?? 0) - 10)).toBeLessThan(1e-2)
    expect(skate).toBeLessThan(0.01)
    expect(maxError).toBeLessThan(0.05)
    expect(body.ownership().leftArm).toBe(1)
    expect(body.diagnostics.feet.contact).toBe(1)
  })

  it('keeps foot contact under a stance clip that keys センター, and ducks it under the same clip as a one-shot', () => {
    const contactUnder = (stance: boolean) => {
      const { pipeline, body, mixer, setInput } = bodyFixture(0, Math.PI, { arms: true })
      const sit = new AnimationClip('sit', 2, [new VectorKeyframeTrack('.bones[センター].position', [0, 2], [0, -3, 0, 0, -3, 0])])
      pipeline.registerClip(sit.name, sit)
      body.registerClip(sit.name, sit)
      pipeline.enqueue(() => mixer.clipAction(sit).play())
      setInput({ stanceClips: new Set(stance ? [sit.name] : []) })
      for (let frame = 0; frame < 90; frame++)
        pipeline.step(1 / 60)
      expect(body.ownership().root).toBe(1)
      return body.diagnostics.feet.contact
    }
    expect(contactUnder(true)).toBe(1)
    expect(contactUnder(false)).toBeLessThan(1)
  })

  it('keeps breath and sway under a finger-only clip', () => {
    const sway = (withClip: boolean) => {
      const { pipeline, body, mixer, bone } = bodyFixture(0, Math.PI, { arms: true })
      if (withClip) {
        const curl = holdClip('fingers-curl', '左人指１', new Euler(-Math.PI / 4, 0, 0))
        pipeline.registerClip(curl.name, curl)
        body.registerClip(curl.name, curl)
        pipeline.enqueue(() => mixer.clipAction(curl).play())
      }
      let groove = 0
      for (let frame = 0; frame < 300; frame++) {
        pipeline.step(1 / 30)
        groove = Math.max(groove, bone('グルーブ').position.length())
      }
      return { groove, owned: body.ownership() }
    }
    const free = sway(false)
    const curled = sway(true)
    expect(curled.owned).toMatchObject({ leftFingers: 1, leftArm: 0, upperBody: 0, root: 0, head: 0 })
    expect(free.groove).toBeGreaterThan(0.1)
    expect(curled.groove).toBeCloseTo(free.groove, 6)
  })

  it('stops the gait for a forced-group clip whose mask keys no root or leg IK bone', () => {
    const { pipeline, body, mixer, mesh, setInput } = bodyFixture(0, Math.PI, { arms: true })
    const bow = holdClip('arm-dance', '左腕', new Euler(0, 0, -Math.PI / 3))
    pipeline.registerClip(bow.name, bow)
    body.registerClip(bow.name, bow, { forceGroups: FULL_BODY })
    pipeline.enqueue(() => mixer.clipAction(bow).play())
    setInput({ rootMotion: true })
    for (let frame = 0; frame < 30; frame++)
      pipeline.step(1 / 60)
    expect(body.ownership()).toMatchObject({ root: 1, leftLegIk: 1, rightLegIk: 1, leftArm: 1, lowerBody: 0 })
    body.setLocomotionGoal({ goalX: 10, pace: 'walk', arriveFacing: 0, reason: 'debug' })
    for (let frame = 0; frame < 120; frame++) {
      pipeline.step(1 / 60)
      expect(body.diagnostics.locomotion).toMatchObject({ mode: 'idle', enabled: false, goalX: null })
      expect(mesh.position.x).toBe(0)
    }
  })

  it('disables the gait while a forced-group layer plays and re-enables it with no stale ownership once its weight is 0', async () => {
    const { mmd, rig, body, mesh, setInput } = bodyFixture(0, Math.PI, { arms: true })
    const manager = createMMDAnimationManager(mmd, { maskBones: mmdClipMaskBones(rig), physicsEnabled: false })
    manager.pipeline.poseStages.push(...body.poseStages)
    manager.pipeline.surfaceStages.push(body.surfaceStage)
    const events: LayerEvent[] = []
    manager.onLayerEvent(event => events.push(event))
    const bow = holdClip('bow', '左腕', new Euler(0, 0, -Math.PI / 3), 0.5)
    manager.registerClip('bow', bow)
    body.registerClip('bow', bow, { forceGroups: FULL_BODY })
    await manager.init()
    setInput({ rootMotion: true, layerClip: 'bow' })
    for (let frame = 0; frame < 30; frame++)
      manager.update(1 / 60)
    expect(body.diagnostics.locomotion?.enabled).toBe(true)
    expect(body.performing()).toBeNull()

    manager.playLayer('bow', { seq: 1, layer: 'full', kind: 'action' })
    let performed = 0
    for (let frame = 0; frame < 240; frame++) {
      manager.update(1 / 60)
      const performing = body.performing()
      if (performing) {
        performed++
        expect(performing.name).toBe('bow')
        expect(body.ownership().root).toBe(performing.weight)
        expect(body.diagnostics.locomotion?.enabled).toBe(false)
        // A goal set while the clip owns the root is dropped, not deferred.
        if (performed === 5)
          body.setLocomotionGoal({ goalX: 10, pace: 'walk', arriveFacing: 0, reason: 'debug' })
      }
    }
    expect(performed).toBeGreaterThan(10)
    expect(events.map(event => event.state)).toEqual(['playing', 'finished'])
    expect(manager.snapshot().layer).toBeNull()
    expect(body.performing()).toBeNull()
    expect(Object.values(body.ownership()).every(weight => weight === 0)).toBe(true)
    expect(body.diagnostics.locomotion).toMatchObject({ mode: 'idle', enabled: true, goalX: null })
    expect(mesh.position.x).toBe(0)

    body.setLocomotionGoal({ goalX: 10, pace: 'walk', arriveFacing: 0, reason: 'debug' })
    for (let frame = 0; frame < 120; frame++)
      manager.update(1 / 60)
    expect(body.diagnostics.locomotion?.mode).not.toBe('idle')
    expect(mesh.position.x).toBeGreaterThan(0.5)
  })

  it('aims both eye rays at a world target after the root moves and turns', () => {
    const { pipeline, body, bone, mesh, setInput, input } = bodyFixture()
    mesh.position.x = 5
    mesh.rotation.y = 0.7
    mesh.updateMatrixWorld(true)
    body.rebase(5, 0.7)
    const target = mesh.localToWorld(new Vector3(4, 21, 30))
    setInput(cursorAt(input.intent, target))
    for (let frame = 0; frame < 180; frame++)
      pipeline.step(1 / 60)
    for (const name of ['左目', '右目']) {
      const eye = bone(name)
      const ray = new Vector3(0, 0, 1).applyQuaternion(eye.getWorldQuaternion(new Quaternion()))
      expect(ray.angleTo(target.clone().sub(eye.getWorldPosition(new Vector3())))).toBeLessThan(Math.PI / 360)
    }
  })
})
