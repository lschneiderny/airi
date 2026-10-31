import { AnimationClip, AnimationMixer, LoopRepeat, NumberKeyframeTrack, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { createModel } from './__fixtures__/model'
import { MMDFramePipeline } from './frame-pipeline'

function fixture() {
  const mmd = createModel()
  const mixer = new AnimationMixer(mmd.mesh)
  const pipeline = new MMDFramePipeline({ mmd, mixer })
  pipeline.options.physics = false
  return { mmd, mixer, pipeline }
}

describe('mmd frame pipeline', () => {
  it('keeps every bone stable for 1000 constant frames without compounding a fixed pose delta', () => {
    const { mmd, pipeline } = fixture()
    const delta = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1)
    pipeline.poseStages.push({
      id: 'fixed-pose',
      run: ({ clean }) => {
        mmd.mesh.skeleton.bones[1].quaternion.copy(clean.quaternions[1]).multiply(delta)
        mmd.mesh.skeleton.bones[0].position.copy(clean.positions[0]).addScalar(0.01)
      },
    })
    pipeline.step(1 / 60)
    const first = mmd.mesh.skeleton.bones.map(b => ({ position: b.position.clone(), quaternion: b.quaternion.clone() }))
    for (let frame = 1; frame < 1000; frame++) {
      pipeline.step(1 / 60)
      mmd.mesh.skeleton.bones.forEach((bone, i) => {
        expect(bone.position.distanceTo(first[i].position)).toBeLessThan(1e-6)
        expect(1 - Math.abs(bone.quaternion.dot(first[i].quaternion))).toBeLessThan(1e-9)
      })
    }
  })

  it('captures mixer output, bind transforms for untracked bones, morphs, and clip weights before pose stages', () => {
    const { mmd, mixer, pipeline } = fixture()
    const head = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3)
    const clip = new AnimationClip('head', 1, [
      new QuaternionKeyframeTrack('.bones[頭].quaternion', [0, 1], [...head.toArray(), ...head.toArray()]),
      new NumberKeyframeTrack('.morphTargetInfluences[0]', [0, 1], [0.4, 0.4]),
    ])
    pipeline.registerClip('head', clip)
    pipeline.enqueue(() => mixer.clipAction(clip).play())
    pipeline.poseStages.push({ id: 'override', run: () => mmd.mesh.skeleton.bones[1].quaternion.identity() })
    pipeline.surfaceStages.push({
      id: 'blink',
      run: () => {
        if (mmd.mesh.morphTargetInfluences)
          mmd.mesh.morphTargetInfluences[1] = 1
      },
    })
    pipeline.step(1 / 60)
    pipeline.step(1 / 60)
    expect(1 - Math.abs(pipeline.clean.quaternions[1].dot(head))).toBeLessThan(1e-9)
    expect(pipeline.clean.positions[0].toArray()).toEqual([0, 10, 0])
    expect(pipeline.clean.morphs[0]).toBeCloseTo(0.4)
    expect(pipeline.clean.morphs[1]).toBe(0)
    expect(pipeline.clean.clipWeights.get('head')).toBe(1)
  })

  it('starts a fade from a clean no-action pose rather than the previous procedural offset', () => {
    const { mmd, mixer, pipeline } = fixture()
    pipeline.poseStages.push({
      id: 'offset',
      run: ({ clean }) => mmd.mesh.skeleton.bones[1].position.copy(clean.positions[1]).addScalar(5),
    })
    pipeline.step(1 / 60)
    const clip = new AnimationClip('rise', 1, [
      new VectorKeyframeTrack('.bones[頭].position', [0, 1], [0, 11, 0, 0, 11, 0]),
    ])
    pipeline.enqueue(() => mixer.clipAction(clip).fadeIn(1).play())
    pipeline.step(0.05)
    expect(pipeline.clean.positions[1].x).toBe(0)
    expect(pipeline.clean.positions[1].y).toBeCloseTo(9.1, 6)
  })

  it('resets physics on a loop wrap and on an explicit reset before updating physics', () => {
    const { mmd, mixer, pipeline } = fixture()
    const events: string[] = []
    mmd.physics = {
      createHelper: () => { throw new Error('Unused helper') },
      reset: () => events.push('reset'),
      update: () => events.push('physics'),
    }
    pipeline.options.physics = true
    const clip = new AnimationClip('loop', 0.1, [
      new VectorKeyframeTrack('.bones[頭].position', [0, 0.1], [0, 9, 0, 0, 9, 0]),
    ])
    pipeline.enqueue(() => mixer.clipAction(clip).setLoop(LoopRepeat, Infinity).play())
    pipeline.step(0.05)
    events.length = 0
    pipeline.step(0.05)
    expect(events).toEqual(['reset', 'physics'])
    events.length = 0
    pipeline.requestPhysicsReset()
    pipeline.step(0.01)
    expect(events).toEqual(['reset', 'physics'])
  })

  it('clamps time and orders registered pose stages before solvers and surface stages after physics', () => {
    const { mmd, mixer, pipeline } = fixture()
    const events: string[] = []
    vi.spyOn(mmd, 'beforePhysics').mockImplementation(() => {
      events.push('beforePhysics')
    })
    vi.spyOn(mmd, 'afterPhysics').mockImplementation(() => {
      events.push('afterPhysics')
    })
    pipeline.poseStages.push(
      { id: 'one', run: () => {
        events.push('one')
      } },
      { id: 'two', run: () => {
        events.push('two')
      } },
    )
    pipeline.surfaceStages.push({ id: 'surface', run: () => {
      events.push('surface')
    } })
    pipeline.step(1)
    expect(mixer.time).toBe(0.05)
    expect(events).toEqual(['one', 'two', 'beforePhysics', 'afterPhysics', 'surface'])
    for (const timing of Object.values(pipeline.timings()))
      expect(Number.isFinite(timing.p95Ms)).toBe(true)
  })

  it('records foot IK track presence for each registered clip', () => {
    const { pipeline } = fixture()
    pipeline.registerClip('left', new AnimationClip('left', 1, [
      new VectorKeyframeTrack('.bones[左足ＩＫ].position', [0, 1], [1, 1, 0, 1, 1, 0]),
    ]))
    expect(pipeline.clipFootIK.get('left')).toEqual({ left: true, right: false })
  })
})
