import { MMD, PmxObject } from '@moeru/three-mmd'
import { Bone, BufferGeometry, MeshBasicMaterial, Skeleton, SkinnedMesh } from 'three'

/** Post-parse, right-handed PMX fixture with a 20-unit body and a real leg IK chain. */
export function createModel() {
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial())
  const definitions: Array<{ name: string, parent: number, position: [number, number, number] }> = [
    { name: 'センター', parent: -1, position: [0, 10, 0] },
    { name: '頭', parent: 0, position: [0, 9, 0] },
    { name: '左目', parent: 1, position: [0.5, 1, 0.5] },
    { name: '右目', parent: 1, position: [-0.5, 1, 0.5] },
    { name: '左足', parent: 0, position: [1, -1, 0] },
    { name: '左ひざ', parent: 4, position: [0, -4, -0.1] },
    { name: '左足首', parent: 5, position: [0, -4, 0.1] },
    { name: '左足ＩＫ', parent: -1, position: [1, 1, 0] },
  ]
  const bones = definitions.map(({ name, position }) => {
    const bone = new Bone()
    bone.name = name
    bone.position.fromArray(position)
    return bone
  })
  definitions.forEach(({ parent }, i) => (parent < 0 ? mesh : bones[parent]).add(bones[i]))
  mesh.bind(new Skeleton(bones))
  mesh.morphTargetInfluences = [0, 0]
  mesh.morphTargetDictionary = { smile: 0, blink: 1 }
  const pmx: PmxObject = {
    header: {
      additionalVec4Count: 0,
      boneIndexSize: 4,
      comment: '',
      encoding: PmxObject.Header.Encoding.Utf8,
      englishComment: '',
      englishModelName: '',
      materialIndexSize: 4,
      modelName: 'fixture',
      morphIndexSize: 4,
      rigidBodyIndexSize: 4,
      signature: 'PMX',
      textureIndexSize: 4,
      version: 2,
      vertexIndexSize: 4,
    },
    bones: definitions.map(({ name, parent }, i) => ({
      name,
      englishName: '',
      position: bones[i].getWorldPosition(bones[i].position.clone()).toArray(),
      parentBoneIndex: parent,
      transformOrder: i,
      flag: i === 7 ? PmxObject.Bone.Flag.IsIkEnabled : 0,
      tailPosition: -1,
      appendTransform: undefined,
      axisLimit: undefined,
      localVector: undefined,
      externalParentTransform: undefined,
      ik: i === 7
        ? {
            target: 6,
            iteration: 8,
            rotationConstraint: Math.PI / 4,
            links: [
              { target: 5, limitation: { minimumAngle: [-Math.PI, 0, 0], maximumAngle: [-0.001, 0, 0] } },
              { target: 4, limitation: undefined },
            ],
          }
        : undefined,
    })),
    displayFrames: [],
    indices: new Uint8Array(),
    joints: [],
    materials: [],
    morphs: [],
    rigidBodies: [],
    softBodies: [],
    textures: [],
    vertices: [],
  }
  return new MMD(pmx, mesh)
}
