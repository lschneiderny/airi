import type { NaturalMotionFrame } from '@proj-airi/motion-driver-natural/natural-motion'

import { AnimationMixer, Euler, Quaternion } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { createModel } from '../__fixtures__/model'
import { MMDFramePipeline } from '../frame-pipeline'
import { readMMDRigProfile } from '../rig'
import { MMDNaturalAdapter } from './adapter'

const input = {
  performance: { mode: 'idle', attention: 'cursor', away: false, reactSeq: 0, reactKind: 'none' },
  energy: 0.5,
  voice: { speaking: false, speechActiveOrRecent: false, level: 0 },
  cursor: { x: 4, y: 0 },
  chat: null,
  placement: null,
} as const

function fixture() {
  const mmd = createModel()
  const pipeline = new MMDFramePipeline({ mmd, mixer: new AnimationMixer(mmd.mesh) })
  pipeline.options.physics = false
  pipeline.options.ik = false
  const rig = readMMDRigProfile(mmd.pmx)
  const adapter = new MMDNaturalAdapter(mmd.mesh, rig, 'fixture')
  const bone = (name: string) => {
    const found = mmd.mesh.skeleton.bones.find(bone => bone.name === name)
    if (!found)
      throw new TypeError(`Fixture bone missing: ${name}`)
    return found
  }
  return { mmd, pipeline, rig, adapter, bone }
}

function output(value: number): NaturalMotionFrame {
  return {
    pose: { headX: value, headY: value, headZ: value, bodyX: value, bodyY: value, bodyZ: value, eyeX: value, eyeY: value },
    fixation: { x: value, y: value },
    face: { eyeOpenMultiplier: 1, eyeOpenHint: 0, browY: 0, browAngle: 0, browLY: 0, browRY: 0, browLAngle: 0, browRAngle: 0, eyeSmile: 0, mouthForm: 0, silentMouthOpen: 0, cheek: 0 },
    blink: { blinkFactor: 1 },
    breath: { value: 0.45, headY: 0 },
  }
}

describe('mmd Natural adapter', () => {
  it('moves head, neck and spine with real seeded Natural output before physics', () => {
    const { adapter, pipeline, bone } = fixture()
    let frame = 0
    let maximumYaw = 0
    pipeline.poseStages.push({ id: 'natural', run: ({ dt, clean }) => {
      adapter.advance(dt, { ...input, cursor: { x: 1.25 + 0.25 * Math.sin(frame++ / 10), y: 0 } })
      adapter.applyPose(clean)
      maximumYaw = Math.max(maximumYaw, adapter.diagnostics.headYaw)
    } })
    for (let step = 0; step < 600; step++)
      pipeline.step(1 / 60)
    for (const name of ['頭', '首', '上半身'])
      expect(bone(name).quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.001)
    expect(adapter.diagnostics.events).toBeGreaterThan(0)
    expect(maximumYaw).toBeGreaterThan(0.02)
  })

  it('clamps held saturation and alternating out of range inputs to the split spans', () => {
    const { adapter, pipeline, bone } = fixture()
    const advance = vi.spyOn(adapter.natural, 'advance')
    for (let frame = 0; frame < 120; frame++) {
      const sign = frame < 60 || frame % 2 === 0 ? 1 : -1
      advance.mockReturnValue(output(sign * (2 + frame / 100)))
      adapter.advance(1 / 60, input)
      adapter.applyPose(pipeline.clean)
      for (const [name, span] of [['頭', Math.PI / 6 * 0.6], ['首', Math.PI / 6 * 0.4], ['上半身', Math.PI / 18 * 0.5], ['上半身2', Math.PI / 18 * 0.5]] as const) {
        const angles = new Euler().setFromQuaternion(bone(name).quaternion, 'YXZ')
        expect(angles.y).toBeCloseTo(sign * span, 10)
        expect(Math.abs(angles.x)).toBeLessThanOrEqual(span + 1e-10)
        expect(Math.abs(angles.z)).toBeLessThanOrEqual(span + 1e-10)
      }
    }
  })

  it('writes absolutely from a nonidentity clean snapshot without drift for 1000 applications', () => {
    const { mmd, adapter, pipeline, bone } = fixture()
    const cleanHead = pipeline.clean.quaternions[1]
    cleanHead.setFromEuler(new Euler(0.1, -0.2, 0.05))
    bone('頭').quaternion.copy(cleanHead)
    vi.spyOn(adapter.natural, 'advance').mockReturnValue(output(0.7))
    adapter.advance(1 / 60, input)
    adapter.applyPose(pipeline.clean)
    const first = bone('頭').quaternion.clone()
    const firstPose = mmd.mesh.skeleton.bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() }))
    const expected = cleanHead.clone().multiply(new Quaternion().setFromEuler(new Euler(-0.7 * Math.PI / 6 * 0.6, 0.7 * Math.PI / 6 * 0.6, -0.7 * Math.PI / 6 * 0.6, 'YXZ')))
    expect(first.angleTo(expected)).toBeLessThan(1e-7)
    for (let frame = 1; frame < 1000; frame++) {
      adapter.applyPose(pipeline.clean)
      mmd.mesh.skeleton.bones.forEach((bone, index) => {
        expect(bone.position.distanceTo(firstPose[index].position)).toBeLessThan(1e-6)
        expect(1 - Math.abs(bone.quaternion.dot(firstPose[index].quaternion))).toBeLessThan(1e-9)
      })
    }
  })

  it('never writes physics owned bones even if a caller retains their humanoid mapping', () => {
    const { adapter, pipeline, rig, bone } = fixture()
    rig.physicsOwned.push('頭', '首', '上半身', '左目')
    const initial = new Quaternion().setFromEuler(new Euler(0.1, 0.2, 0.3))
    for (const name of rig.physicsOwned)
      bone(name).quaternion.copy(initial)
    vi.spyOn(adapter.natural, 'advance').mockReturnValue(output(2))
    adapter.advance(1 / 60, input)
    for (let frame = 0; frame < 100; frame++) {
      adapter.applyPose(pipeline.clean)
      for (const name of rig.physicsOwned)
        expect(bone(name).quaternion.angleTo(initial)).toBeLessThan(1e-7)
    }
  })

  it('tolerates a missing head and a model with no recognized rig', () => {
    const { mmd, pipeline } = fixture()
    const rig = readMMDRigProfile({ ...mmd.pmx, bones: mmd.pmx.bones.map(bone => ({ ...bone, name: `unknown-${bone.name}` })) })
    const adapter = new MMDNaturalAdapter(mmd.mesh, rig, 'no-rig')
    const before = mmd.mesh.skeleton.bones.map(bone => bone.quaternion.clone())
    adapter.advance(1 / 60, input)
    adapter.applyPose(pipeline.clean)
    expect(adapter.diagnostics.headYaw).toBe(0)
    mmd.mesh.skeleton.bones.forEach((bone, index) => expect(bone.quaternion.toArray()).toEqual(before[index].toArray()))
  })
})
