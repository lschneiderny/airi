import type { MMDBodyInput } from './index'

import { MMD, PmxObject } from '@moeru/three-mmd'
import { AnimationMixer, Bone, BufferGeometry, MeshBasicMaterial, Quaternion, Skeleton, SkinnedMesh, Vector3 } from 'three'

import { createModel } from '../__fixtures__/model'
import { MMDFramePipeline } from '../frame-pipeline'
import { readMMDRigProfile } from '../rig'
import { MMDBody } from './index'

/** Both legs, positive post-parse knees, and a nonidentity IK parent. No model assets. */
export function bodyFixture(eyeBindYaw = 0, kneeMax = Math.PI) {
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial())
  const definitions: Array<{ name: string, parent: number, position: [number, number, number] }> = [
    { name: 'センター', parent: -1, position: [0, 10, 0] },
    { name: 'グルーブ', parent: 0, position: [0, 0, 0] },
    { name: '下半身', parent: 1, position: [0, 1, 0] },
    { name: '上半身', parent: 1, position: [0, 2, 0] },
    { name: '上半身2', parent: 3, position: [0, 3, 0] },
    { name: '首', parent: 4, position: [0, 2, 0] },
    { name: '頭', parent: 5, position: [0, 1, 0] },
    { name: '左目', parent: 6, position: [0.4, 0.8, 0.5] },
    { name: '右目', parent: 6, position: [-0.4, 0.8, 0.5] },
    { name: '左足', parent: 2, position: [1, 0, 0] },
    { name: '左ひざ', parent: 9, position: [0, -5, -0.1] },
    { name: '左足首', parent: 10, position: [0, -5, 0.1] },
    { name: '右足', parent: 2, position: [-1, 0, 0] },
    { name: '右ひざ', parent: 12, position: [0, -5, -0.1] },
    { name: '右足首', parent: 13, position: [0, -5, 0.1] },
    { name: 'IK親', parent: -1, position: [3, 0, 2] },
    { name: '左足ＩＫ', parent: 15, position: [-2, 1, -2] },
    { name: '右足ＩＫ', parent: 15, position: [-4, 1, -2] },
  ]
  const bones = definitions.map(({ name, position }) => {
    const bone = new Bone()
    bone.name = name
    bone.position.fromArray(position)
    return bone
  })
  definitions.forEach(({ parent }, index) => (parent < 0 ? mesh : bones[parent]).add(bones[index]))
  bones[15].quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.4)
  bones[16].position.applyQuaternion(bones[15].quaternion.clone().invert())
  bones[17].position.applyQuaternion(bones[15].quaternion.clone().invert())
  for (const index of [7, 8])
    bones[index].quaternion.setFromAxisAngle(new Vector3(0, 1, 0), eyeBindYaw)
  mesh.updateMatrixWorld(true)
  mesh.bind(new Skeleton(bones))
  const shell = createModel()
  const pmx: PmxObject = {
    ...shell.pmx,
    bones: definitions.map(({ name, parent }, index) => ({
      ...shell.pmx.bones[0],
      name,
      parentBoneIndex: parent,
      position: bones[index].getWorldPosition(new Vector3()).toArray(),
      transformOrder: index,
      flag: index >= 16 ? PmxObject.Bone.Flag.IsIkEnabled : 0,
      ik: index >= 16
        ? {
            target: index === 16 ? 11 : 14,
            iteration: 64,
            rotationConstraint: Math.PI / 4,
            links: [
              { target: index === 16 ? 10 : 13, limitation: { minimumAngle: [0.0087, 0, 0], maximumAngle: [kneeMax, 0, 0] } },
              { target: index === 16 ? 9 : 12, limitation: undefined },
            ],
          }
        : undefined,
    })),
  }
  shell.dispose()
  const mmd = new MMD(pmx, mesh)
  const mixer = new AnimationMixer(mesh)
  const pipeline = new MMDFramePipeline({ mmd, mixer })
  pipeline.options.physics = false
  const rig = readMMDRigProfile(pmx)
  const input: MMDBodyInput = {
    enabled: true,
    disableFootContact: false,
    disableLookAt: false,
    target: null,
    frame: {
      pose: { headX: 0, headY: 0, headZ: 0, bodyX: 0, bodyY: 0, bodyZ: 0, eyeX: 0, eyeY: 0 },
      fixation: { x: 0, y: 0 },
      face: { eyeOpenMultiplier: 1, eyeOpenHint: 0, browY: 0, browAngle: 0, browLY: 0, browRY: 0, browLAngle: 0, browRAngle: 0, eyeSmile: 0, mouthForm: 0, silentMouthOpen: 0, cheek: 0 },
      blink: { blinkFactor: 1 },
      breath: { value: 0.45, headY: 0 },
    },
  }
  let current = input
  const body = new MMDBody(mmd, rig, { modelKey: 'body-test', input: () => current })
  const setInput = (next: Partial<MMDBodyInput>) => {
    current = { ...current, ...next }
  }
  pipeline.poseStages.push({ id: 'natural', run: () => {} }, ...body.poseStages)
  pipeline.surfaceStages.push(body.surfaceStage)
  const bone = (name: string) => {
    const found = bones.find(bone => bone.name === name)
    if (!found)
      throw new TypeError(`Missing fixture bone ${name}`)
    return found
  }
  return { mmd, mesh, bones, bone, mixer, pipeline, body, rig, input, setInput, identity: new Quaternion() }
}
