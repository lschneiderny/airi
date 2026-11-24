import type { ClearanceMeshSource } from './analysis'
import type { Point } from './geometry'

/**
 * A small skinned body for the clearance tests, in model units with +Y up. The left arm hangs straight down from the
 * shoulder at (1, 14, 0) to the elbow at (1, 11, 0) and the wrist at (1, 8, 0); it has no right arm and no fingers.
 * Bones: 0 hips, 1 spine, 2 head, 3 upper arm, 4 elbow, 5 wrist, 6 a simulated skirt bone under the hips, and 7 a prop
 * bone outside every region.
 *
 * Triangles, in order:
 * 0. `coat`: a level panel on the spine at y = 10 that the hanging forearm crosses.
 * 1. `skirt`: a panel on the skirt bone, far from the arm.
 * 2. `head`: a panel on the head.
 * 3. `sleeve`: a panel with one corner on the elbow bone.
 * 4. `cuff`: a spine panel with one corner beside the forearm, so the arm wears it.
 * 5. `prop`: a panel on the prop bone.
 * 6. `chest`: a spine panel beside the coat, within the structural radius of it.
 *
 * Vertices after the triangles' corners ring the upper arm at radius 0.3, so its sleeve measures 0.1 of its length.
 */
export function testMesh(): ClearanceMeshSource {
  const bones: ClearanceMeshSource['bones'] = [
    { parent: -1, position: [0, 10, 0], simulated: false },
    { parent: 0, position: [0, 12, 0], simulated: false },
    { parent: 1, position: [0, 15, 0], simulated: false },
    { parent: 1, position: [1, 14, 0], simulated: false },
    { parent: 3, position: [1, 11, 0], simulated: false },
    { parent: 4, position: [1, 8, 0], simulated: false },
    { parent: 0, position: [0, 9, 0], simulated: true },
    { parent: -1, position: [5, 0, 0], simulated: false },
  ]
  const vertices: { at: Point, bone: number }[] = []
  const triangles: number[] = []
  const panel = (bone: number, corners: Point[], cornerBones: number[] = [bone, bone, bone]) => {
    corners.forEach((at, i) => {
      triangles.push(vertices.length)
      vertices.push({ at, bone: cornerBones[i] })
    })
  }
  panel(1, [[0.4, 10, -0.6], [1.6, 10, -0.6], [1, 10, 0.8]])
  panel(6, [[-1, 7, 1], [0, 7, 1], [-0.5, 6, 1]])
  panel(2, [[-0.5, 15, 0.5], [0.5, 15, 0.5], [0, 16, 0.5]])
  panel(1, [[0, 11, 1], [0.5, 11, 1], [1, 11, 0.2]], [1, 1, 4])
  panel(1, [[0, 9, 1], [0.5, 9, 1], [1.1, 9, 0.1]])
  panel(7, [[5, 0, 0], [6, 0, 0], [5, 1, 0]])
  panel(1, [[0.5, 10.2, -0.6], [0.5, 10.2, -0.2], [0.8, 10.2, -0.6]])
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12
    vertices.push({ at: [1 + 0.3 * Math.cos(angle), 12.5, 0.3 * Math.sin(angle)], bone: 3 })
  }
  return {
    bones,
    regionRoots: { arm: [3], head: [2], upper: [1], lower: [0] },
    arms: { left: { upper: 3, elbow: 4, wrist: 5, tip: null }, right: null },
    hips: 0,
    positions: vertices.flatMap(vertex => [...vertex.at]),
    skinIndex: vertices.flatMap(vertex => [vertex.bone, 0, 0, 0]),
    skinWeight: vertices.flatMap(() => [1, 0, 0, 0]),
    bindMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    triangles,
    triangleMaterials: [0, 1, 2, 0, 0, 0, 0],
    materials: ['coat', 'skirt', 'skin'],
  }
}

/** A pose of the test mesh: every bone at its bind place except the moved ones, given as world translations. */
export function testPose(moved: Record<number, Point> = {}): { skin: Float64Array, joints: Float64Array } {
  const mesh = testMesh()
  const skin = new Float64Array(mesh.bones.length * 16)
  const joints = new Float64Array(mesh.bones.length * 3)
  mesh.bones.forEach((bone, i) => {
    const at = moved[i] ?? bone.position
    skin.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, at[0] - bone.position[0], at[1] - bone.position[1], at[2] - bone.position[2], 1], i * 16)
    joints.set(at, i * 3)
  })
  return { skin, joints }
}
