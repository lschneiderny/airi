import type { BodyMeshSource } from './contracts'

/** One bone of the synthetic skeleton: a name the tests read, its parent's name, and its bind position. */
interface FixtureBone {
  readonly name: string
  readonly parent: string | null
  readonly at: readonly [number, number, number]
}

/**
 * A plain standing skeleton, 17 units tall to the head bone, with a shoulder span of 2.4: hips, two spine bones (the
 * spine a sibling of the hips, as MMD has it), neck, head, both arms in an A-pose, and both legs.
 */
const SKELETON: readonly FixtureBone[] = [
  { name: 'root', parent: null, at: [0, 0, 0] },
  { name: 'hips', parent: 'root', at: [0, 10, 0] },
  { name: 'spine', parent: 'root', at: [0, 11, 0] },
  { name: 'chest', parent: 'spine', at: [0, 13, 0] },
  { name: 'neck', parent: 'chest', at: [0, 15.5, 0] },
  { name: 'head', parent: 'neck', at: [0, 16.3, 0] },
  ...(['left', 'right'] as const).flatMap((side): FixtureBone[] => {
    const s = side === 'left' ? 1 : -1
    return [
      { name: `${side}Clavicle`, parent: 'chest', at: [0.2 * s, 15.2, 0] },
      { name: `${side}Upper`, parent: `${side}Clavicle`, at: [1.2 * s, 15, 0] },
      { name: `${side}Lower`, parent: `${side}Upper`, at: [3.2 * s, 13.3, 0] },
      { name: `${side}Hand`, parent: `${side}Lower`, at: [5 * s, 11.7, 0] },
      { name: `${side}Thigh`, parent: 'hips', at: [0.6 * s, 10, 0] },
      { name: `${side}Shin`, parent: `${side}Thigh`, at: [0.6 * s, 5.5, 0] },
      { name: `${side}Foot`, parent: `${side}Shin`, at: [0.6 * s, 1, 0] },
    ]
  }),
]

export interface MeshBuilder {
  /** Adds a bone and returns its name. */
  bone: (name: string, parent: string, at: readonly [number, number, number]) => string
  /** Marks a bone as simulated, with its mobility in model units and whether the simulator collides it with an arm. */
  simulate: (name: string, mobility: number, collidesWithArm?: boolean) => void
  /**
   * A horizontal ellipse of vertices at height `y`, all skinned to one bone, or each to the bone `bone` names for its
   * place around the ring. A ring alone has no triangles.
   */
  ring: (bone: RingBone, y: number, halfWidth: number, halfDepth: number, centre?: { x?: number, z?: number }) => void
  /**
   * A surface of rings between two heights, 0.1 apart at most, with half-widths blended from the first to the second
   * and triangles between each ring and the next.
   */
  tube: (bone: RingBone, fromY: number, toY: number, from: readonly [number, number], to?: readonly [number, number], centre?: { x?: number, z?: number }) => void
  /** A surface of rings around the segment between two bones, skinned to the first. */
  limb: (bone: string, toBone: string, radius: number) => void
  build: () => BodyMeshSource
  index: (name: string) => number
}

const RING_VERTICES = 24

/** The bone of every vertex of a ring, or of the vertex at each of its 24 places. */
type RingBone = string | ((place: number) => string)

/** A synthetic skinned mesh on the standing skeleton. A new builder has the skeleton and no vertices. */
export function meshBuilder(): MeshBuilder {
  const bones: FixtureBone[] = [...SKELETON]
  const positions: number[] = []
  const skinIndices: number[] = []
  const skinWeights: number[] = []
  const triangles: number[] = []
  const simulated = new Map<string, { mobility: number, collidesWithArm: boolean }>()
  const index = (name: string) => {
    const found = bones.findIndex(bone => bone.name === name)
    if (found < 0)
      throw new TypeError(`Missing fixture bone ${name}`)
    return found
  }
  const vertex = (bone: string, x: number, y: number, z: number) => {
    positions.push(x, y, z)
    skinIndices.push(index(bone), 0, 0, 0)
    skinWeights.push(1, 0, 0, 0)
  }
  const ring: MeshBuilder['ring'] = (bone, y, halfWidth, halfDepth, centre = {}) => {
    for (let k = 0; k < RING_VERTICES; k++) {
      const angle = 2 * Math.PI * k / RING_VERTICES
      vertex(typeof bone === 'string' ? bone : bone(k), (centre.x ?? 0) + halfWidth * Math.cos(angle), y, (centre.z ?? 0) + halfDepth * Math.sin(angle))
    }
  }
  /** Two triangles for each quad between the last ring and the one before it. */
  const join = () => {
    const upper = positions.length / 3 - RING_VERTICES
    const lower = upper - RING_VERTICES
    for (let k = 0; k < RING_VERTICES; k++) {
      const next = (k + 1) % RING_VERTICES
      triangles.push(lower + k, lower + next, upper + k, lower + next, upper + next, upper + k)
    }
  }
  return {
    index,
    bone: (name, parent, at) => {
      bones.push({ name, parent, at })
      return name
    },
    simulate: (name, mobility, collidesWithArm = false) => {
      simulated.set(name, { mobility, collidesWithArm })
    },
    ring,
    tube: (bone, fromY, toY, from, to = from, centre) => {
      const steps = Math.max(1, Math.ceil(Math.abs(toY - fromY) / 0.1))
      for (let step = 0; step <= steps; step++) {
        const t = step / steps
        ring(bone, fromY + (toY - fromY) * t, from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, centre)
        if (step > 0)
          join()
      }
    },
    limb: (bone, toBone, radius) => {
      const a = bones[index(bone)].at
      const b = bones[index(toBone)].at
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      // The segments of this skeleton run in the frontal plane, so the ring spans their in-plane normal and Z.
      const normal = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length]
      for (let step = 0; step <= 20; step++) {
        const t = step / 20
        for (let k = 0; k < RING_VERTICES; k++) {
          const angle = 2 * Math.PI * k / RING_VERTICES
          vertex(bone, a[0] + (b[0] - a[0]) * t + radius * Math.cos(angle) * normal[0], a[1] + (b[1] - a[1]) * t + radius * Math.cos(angle) * normal[1], a[2] + radius * Math.sin(angle))
        }
        if (step > 0)
          join()
      }
    },
    build: () => ({
      positions,
      skinIndices,
      skinWeights,
      triangles,
      bones: bones.map(bone => ({ parent: bone.parent === null ? -1 : index(bone.parent), position: { x: bone.at[0], y: bone.at[1], z: bone.at[2] } })),
      canonical: {
        hips: index('hips'),
        spine: [index('spine'), index('chest')],
        neck: index('neck'),
        head: index('head'),
        arms: {
          left: { clavicle: index('leftClavicle'), upper: index('leftUpper'), lower: index('leftLower'), hand: index('leftHand') },
          right: { clavicle: index('rightClavicle'), upper: index('rightUpper'), lower: index('rightLower'), hand: index('rightHand') },
        },
        legs: {
          left: { upper: index('leftThigh'), lower: index('leftShin'), foot: index('leftFoot') },
          right: { upper: index('rightThigh'), lower: index('rightShin'), foot: index('rightFoot') },
        },
      },
      simulated: [...simulated].map(([name, entry]) => ({ bone: index(name), ...entry })).sort((a, b) => a.bone - b.bone),
    }),
  }
}

/** Her bare body: hips, waist and chest 1 unit to each side, a head, both arms and both thighs. */
export function bareBody(): MeshBuilder {
  const mesh = meshBuilder()
  mesh.tube('hips', 8.6, 11, [1, 0.7])
  mesh.tube('spine', 11, 13, [0.9, 0.65])
  mesh.tube('chest', 13, 15.4, [1, 0.7])
  mesh.tube('neck', 15.4, 16.2, [0.3, 0.3])
  mesh.tube('head', 16.2, 17.8, [0.75, 0.8])
  for (const side of ['left', 'right'] as const) {
    mesh.limb(`${side}Upper`, `${side}Lower`, 0.3)
    mesh.limb(`${side}Lower`, `${side}Hand`, 0.25)
    mesh.limb(`${side}Thigh`, `${side}Shin`, 0.55)
  }
  return mesh
}
