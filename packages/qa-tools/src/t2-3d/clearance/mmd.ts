import type { MMD } from '@moeru/three-mmd'
import type { HumanoidBoneName, HumanoidFingerBoneName } from '@proj-airi/motion-driver-humanoid/types'
import type { Bone, Object3D, SkinnedMesh } from 'three'

import type { ClearanceAnalysis, ClearanceArm, ClearanceMeshSource, Side } from './analysis'
import type { ClearancePose, Motion3dClearance } from './measure'

import { MMDFramePipeline } from '@proj-airi/stage-ui-mmd/composables/mmd/frame-pipeline'
import { readMMDRigProfile } from '@proj-airi/stage-ui-mmd/composables/mmd/rig'
import { AnimationMixer, Matrix4 } from 'three'

import { loadHeadlessMMD } from '../runner/loader'
import { analyseClearanceMesh, requireMeasurable, withoutStructural } from './analysis'
import { ClearanceMeasure } from './measure'

/** The measure samples every second frame of the 60 Hz run, at 30 Hz. */
export const CLEARANCE_SAMPLE_STEP = 2
/** The bind-pose settle: frames stepped with no motion stages, and the frames from which crossings are collected. */
const SETTLE_FRAMES = 180
const SETTLE_FROM = 120
const SETTLE_EVERY = 10

/** The middle finger's base, by preference; the hand segment ends there. */
const TIP_BONES = ['MiddleProximal', 'MiddleMetacarpal', 'MiddleIntermediate', 'MiddleDistal'] as const

/** Reads a loaded MMD model into a `ClearanceMeshSource`: bones and the rig's canonical names from the PMX, skin and triangles from the mesh. */
export function readClearanceSource(mmd: MMD): ClearanceMeshSource {
  const { pmx, mesh } = mmd
  const rig = readMMDRigProfile(pmx)
  const indicesOf = (names: readonly (string | null | undefined)[]) => {
    const wanted = new Set(names.filter(name => typeof name === 'string'))
    return pmx.bones.flatMap((bone, index) => wanted.has(bone.name) ? [index] : [])
  }
  const canonical = (keys: readonly HumanoidBoneName[]) => indicesOf(keys.map(key => rig.bones[key]))
  const indexOf = (name: string | undefined) => name === undefined ? -1 : pmx.bones.findIndex(bone => bone.name === name)
  const arm = (side: Side): ClearanceArm | null => {
    const [upper, elbow, wrist] = (['UpperArm', 'LowerArm', 'Hand'] as const).map(part => indexOf(rig.bones[`${side}${part}`]))
    if (upper < 0 || elbow < 0 || wrist < 0)
      return null
    const tip = TIP_BONES.map(part => indexOf(rig.fingerBones[`${side}${part}` satisfies HumanoidFingerBoneName])).find(index => index >= 0)
    return { upper, elbow, wrist, tip: tip ?? null }
  }
  const simulated = new Set(pmx.rigidBodies.flatMap(body => body.physicsMode !== 0 && body.boneIndex >= 0 ? [body.boneIndex] : []))
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const skinIndexAttribute = geometry.getAttribute('skinIndex')
  const skinWeightAttribute = geometry.getAttribute('skinWeight')
  const positions = new Float64Array(position.count * 3)
  const skinIndex = new Uint16Array(position.count * 4)
  const skinWeight = new Float32Array(position.count * 4)
  for (let i = 0; i < position.count; i++) {
    for (let k = 0; k < 3; k++)
      positions[i * 3 + k] = position.getComponent(i, k)
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = skinIndexAttribute.getComponent(i, k)
      skinWeight[i * 4 + k] = skinWeightAttribute.getComponent(i, k)
    }
  }
  const index = geometry.index
  const triangles = new Uint32Array(index ? index.count : position.count)
  for (let i = 0; i < triangles.length; i++)
    triangles[i] = index ? index.getX(i) : i
  const triangleMaterials = new Uint16Array(triangles.length / 3)
  for (const group of geometry.groups) {
    for (let t = group.start / 3; t < (group.start + group.count) / 3; t++)
      triangleMaterials[t] = group.materialIndex ?? 0
  }
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const hips = indexOf(rig.bones.hips)
  return {
    bones: pmx.bones.map((bone, i) => ({ parent: bone.parentBoneIndex, position: [bone.position[0], bone.position[1], bone.position[2]], simulated: simulated.has(i) })),
    regionRoots: {
      arm: canonical(['leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm']),
      head: canonical(['head', 'neck']),
      upper: canonical(['spine', 'chest', 'upperChest']),
      lower: indicesOf([rig.bones.hips, rig.hipsTranslation.center, rig.hipsTranslation.groove]),
    },
    arms: { left: arm('left'), right: arm('right') },
    hips: hips < 0 ? null : hips,
    positions,
    skinIndex,
    skinWeight,
    bindMatrix: mesh.bindMatrix.elements,
    triangles,
    triangleMaterials,
    materials: materials.map((material, i) => material.name || `material-${i}`),
  }
}

/**
 * Reads a skinned mesh's pose without writing to it: each bone's world matrix is composed from the local transforms
 * that the pipeline wrote, as `updateMatrixWorld` would, into buffers this reader owns. Calling `updateMatrixWorld`
 * instead would write the mesh's matrices between pipeline steps, and the run must not change because it is measured.
 */
export class ClearancePoseReader {
  private readonly bones: readonly Bone[]
  private readonly inverses: readonly Matrix4[]
  /** Each bone's parent bone index, or -1 when it hangs from the mesh. */
  private readonly parents: Int32Array
  /** Bones ordered parents first. */
  private readonly order: readonly number[]
  private readonly worlds: Matrix4[]
  private readonly meshWorld = new Matrix4()
  private readonly local = new Matrix4()
  private readonly product = new Matrix4()
  readonly pose: ClearancePose

  constructor(readonly mesh: SkinnedMesh) {
    this.bones = mesh.skeleton.bones
    this.inverses = mesh.skeleton.boneInverses
    const indices = new Map<Object3D, number>(this.bones.map((bone, i) => [bone, i]))
    this.parents = Int32Array.from(this.bones.map(bone => bone.parent ? indices.get(bone.parent) ?? -1 : -1))
    const depth = (i: number): number => this.parents[i] < 0 ? 0 : 1 + depth(this.parents[i])
    const depths = this.bones.map((_, i) => depth(i))
    this.order = this.bones.map((_, i) => i).sort((a, b) => depths[a] - depths[b] || a - b)
    this.worlds = this.bones.map(() => new Matrix4())
    this.pose = { skin: new Float64Array(this.bones.length * 16), joints: new Float64Array(this.bones.length * 3) }
  }

  read(): ClearancePose {
    const { mesh } = this
    this.meshWorld.compose(mesh.position, mesh.quaternion, mesh.scale)
    if (mesh.parent)
      this.meshWorld.premultiply(mesh.parent.matrixWorld)
    for (const i of this.order) {
      const bone = this.bones[i]
      this.local.compose(bone.position, bone.quaternion, bone.scale)
      const parent = this.parents[i] < 0 ? (bone.parent === mesh ? this.meshWorld : bone.parent?.matrixWorld ?? this.meshWorld) : this.worlds[this.parents[i]]
      this.worlds[i].multiplyMatrices(parent, this.local)
      this.pose.skin.set(this.product.multiplyMatrices(this.worlds[i], this.inverses[i]).elements, i * 16)
      const e = this.worlds[i].elements
      this.pose.joints[i * 3] = e[12]
      this.pose.joints[i * 3 + 1] = e[13]
      this.pose.joints[i * 3 + 2] = e[14]
    }
    return this.pose
  }
}

/** Measures a run's scored frames through the runner's read-only `onFrame` hook. */
export class MMDClearanceRecorder {
  private readonly measure: ClearanceMeasure
  private reader: ClearancePoseReader | null = null

  constructor(analysis: ClearanceAnalysis, private readonly warmupFrames: number) {
    this.measure = new ClearanceMeasure(analysis, CLEARANCE_SAMPLE_STEP)
  }

  readonly onFrame = (frame: number, mesh: SkinnedMesh): void => {
    const scored = frame - this.warmupFrames
    if (scored < 0 || scored % CLEARANCE_SAMPLE_STEP !== 0)
      return
    if (this.reader?.mesh !== mesh)
      this.reader = new ClearancePoseReader(mesh)
    this.measure.sample(scored, this.reader.read())
  }

  finish(): Motion3dClearance {
    return this.measure.finish()
  }
}

/**
 * Analyses a model for the clearance measure on its own copy, so the measured run stays untouched: classifies the
 * triangles, then steps the copy with no motion stages for 3 s, the arms in the bind pose and the cloth settling under
 * physics, and drops the triangles the arm's centreline still crosses there (`withoutStructural`).
 */
export async function analyseClearanceModel(model: string): Promise<ClearanceAnalysis> {
  const loaded = await loadHeadlessMMD(model)
  const { mmd } = loaded
  const mixer = new AnimationMixer(mmd.mesh)
  const pipeline = new MMDFramePipeline({ mmd, mixer })
  try {
    const source = readClearanceSource(mmd)
    const analysis = requireMeasurable(analyseClearanceMesh(source))
    const probe = new ClearanceMeasure(analysis, SETTLE_EVERY)
    const reader = new ClearancePoseReader(mmd.mesh)
    const crossed = new Set<number>()
    for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
      pipeline.step(1 / 60)
      if (frame >= SETTLE_FROM && frame % SETTLE_EVERY === 0)
        probe.sample(frame, reader.read()).forEach(hit => crossed.add(hit.triangle))
    }
    return requireMeasurable(withoutStructural(analysis, crossed))
  }
  finally {
    pipeline.dispose()
    mixer.uncacheRoot(mmd.mesh)
    loaded.dispose()
  }
}
