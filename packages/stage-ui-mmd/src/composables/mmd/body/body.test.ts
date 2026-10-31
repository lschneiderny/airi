import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'

import { bodyFixture } from './fixture'
import { MMDBody } from './index'

describe('mmd full-body stages', () => {
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
    const { pipeline, bone, setInput } = bodyFixture()
    const target = new Vector3(4, 21, 30)
    setInput({ target })
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

  it('keeps solved feet on the stepping arcs during alternating body turns', () => {
    const { pipeline, body, setInput } = bodyFixture()
    let lift = 0
    for (let frame = 0; frame < 600; frame++) {
      setInput({ target: new Vector3(frame < 300 ? -30 : 30, 18, 2) })
      pipeline.step(1 / 30)
      if (frame >= 10)
        expect(body.diagnostics.feet.maxError).toBeLessThan(0.01)
      lift = Math.max(lift, body.diagnostics.lookAt.turns)
    }
    expect(lift).toBeGreaterThanOrEqual(2)
  })

  it('resolves eye signs from rotated bind axes instead of flipping parsed Z again', () => {
    const { pipeline, bone, setInput } = bodyFixture(Math.PI)
    const target = new Vector3(-3, 20, 30)
    setInput({ target })
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
    const { pipeline, bone, setInput } = bodyFixture()
    for (let frame = 0; frame < 120; frame++) {
      const sign = frame < 60 || frame % 2 === 0 ? 1 : -1
      setInput({ target: new Vector3(sign * (100 + frame), sign * 150, 0) })
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
    const { pipeline, body, bone, setInput } = bodyFixture()
    setInput({ target: new Vector3(10, 20, 30) })
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
    const { pipeline, body, setInput, bone } = bodyFixture()
    setInput({ target: new Vector3(-30, 18, 2) })
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
    const { pipeline, mixer, bone, setInput } = bodyFixture()
    const rotation = new Quaternion().setFromEuler(new Euler(0.1, 0.2, 0))
    const clip = new AnimationClip('one-shot', 1, [
      new QuaternionKeyframeTrack('.bones[頭].quaternion', [0, 1], [...rotation.toArray(), ...rotation.toArray()]),
    ])
    pipeline.registerClip(clip.name, clip)
    pipeline.enqueue(() => mixer.clipAction(clip).play())
    setInput({ target: new Vector3(10, 22, 20) })
    for (let frame = 0; frame < 60; frame++)
      pipeline.step(1 / 30)
    expect(bone('頭').quaternion.clone().normalize().angleTo(rotation)).toBeLessThan(1e-6)
    expect(bone('グルーブ').position.length()).toBeLessThan(1e-6)
    expect(bone('左目').quaternion.angleTo(new Quaternion())).toBeLessThan(1e-6)
  })

  it('keeps half of the head look-at under a fully weighted stance clip while ducking the body', () => {
    const headAngle = (clipped: boolean, stanceClips: ReadonlySet<string>) => {
      const { pipeline, mixer, bone, setInput } = bodyFixture()
      if (clipped) {
        const clip = new AnimationClip('sit', 1, [new VectorKeyframeTrack('.bones[センター].position', [0, 1], [0, 10, 0, 0, 10, 0])])
        pipeline.registerClip(clip.name, clip)
        pipeline.enqueue(() => mixer.clipAction(clip).play())
      }
      let groove = 0
      for (let frame = 0; frame < 240; frame++) {
        setInput({ target: new Vector3(Math.sin(frame / 20) * 12 + 14, 22, 20), stanceClips })
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
    const body = new MMDBody(mmd, rig, { modelKey: 'partial', input: () => ({ ...input, target: new Vector3(3, 20, 30) }) })
    pipeline.poseStages.splice(0, pipeline.poseStages.length, ...body.poseStages)
    pipeline.surfaceStages.splice(0, pipeline.surfaceStages.length, body.surfaceStage)
    pipeline.step(1 / 30)
    expect(body.diagnostics.feet.contact).toBe(0)
    expect(bones.find(bone => bone.name === '頭')?.quaternion.toArray()).toEqual([0, 0, 0, 1])
    expect(bones.find(bone => bone.name === '左目')?.quaternion.toArray()).toEqual([0, 0, 0, 1])
    expect(bones.find(bone => bone.name === '右目')?.quaternion.y).toBeGreaterThan(0)
  })
})
