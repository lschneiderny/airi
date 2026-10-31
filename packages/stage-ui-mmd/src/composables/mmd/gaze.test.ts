import { AnimationClip, AnimationMixer, Euler, Quaternion, QuaternionKeyframeTrack } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { createModel } from './__fixtures__/model'
import { MMDFramePipeline } from './frame-pipeline'
import { createGazeController } from './gaze'

describe('classic MMD gaze', () => {
  it('composes a head clip with gaze before physics instead of replacing the clip rotation', () => {
    const mmd = createModel()
    const mixer = new AnimationMixer(mmd.mesh)
    const pipeline = new MMDFramePipeline({ mmd, mixer })
    pipeline.options.physics = false
    const gaze = createGazeController(mmd.mesh)
    const clipRotation = new Quaternion().setFromEuler(new Euler(0.3, 0, 0))
    const clip = new AnimationClip('nod', 1, [
      new QuaternionKeyframeTrack('.bones[頭].quaternion', [0, 1], [...clipRotation.toArray(), ...clipRotation.toArray()]),
    ])
    pipeline.enqueue(() => mixer.clipAction(clip).play())
    pipeline.poseStages.push({ id: 'classic-gaze', run: ({ dt, clean }) => gaze.update({ x: 1, y: 0 }, dt, clean) })
    const inputToPhysics = new Quaternion()
    const beforePhysics = mmd.beforePhysics.bind(mmd)
    vi.spyOn(mmd, 'beforePhysics').mockImplementation((options) => {
      inputToPhysics.copy(mmd.mesh.skeleton.bones[1].quaternion)
      beforePhysics(options)
    })

    pipeline.step(0.05)

    const gazeDelta = new Quaternion().setFromEuler(new Euler(0, 0.2 * (1 - Math.exp(-0.5)), 0))
    const expected = clipRotation.clone().multiply(gazeDelta)
    expect(inputToPhysics.angleTo(expected)).toBeLessThan(1e-6)
    expect(mmd.mesh.skeleton.bones[1].quaternion.angleTo(expected)).toBeLessThan(1e-6)
    expect(pipeline.clean.quaternions[1].angleTo(clipRotation)).toBeLessThan(1e-6)
  })
})
