import type { Point } from './geometry'

import { distance, lerp, quantile, segmentDistance } from './geometry'

/** What a tested triangle belongs to, from the dominant bones of its corners. */
export const CLEARANCE_CLASSES = ['upper-rigid', 'upper-cloth', 'lower-rigid', 'lower-cloth', 'head-rigid', 'hair'] as const
export type ClearanceClass = typeof CLEARANCE_CLASSES[number]
/** Classes counted as pierced: her body and clothing below the neck. Head and hair crossings are reported apart. */
export const PIERCED_CLASSES: ReadonlySet<number> = new Set([0, 1, 2, 3])

export type Side = 'left' | 'right'
export const SIDES: readonly Side[] = ['left', 'right']

/** One arm's bones, as indices into the source's bones. `tip` is the base of the middle finger, when the rig has one. */
export interface ClearanceArm {
  readonly upper: number
  readonly elbow: number
  readonly wrist: number
  readonly tip: number | null
}

/** A skinned mesh in plain arrays, read once from a loaded model. Lengths are model units. */
export interface ClearanceMeshSource {
  /** Every bone: its parent index (-1 at a root), bind position, and whether a simulated rigid body drives it. */
  readonly bones: readonly { readonly parent: number, readonly position: Point, readonly simulated: boolean }[]
  /** The bones whose descendants (themselves included) belong to each region; the first match up the chain wins, in this order. */
  readonly regionRoots: { readonly arm: readonly number[], readonly head: readonly number[], readonly upper: readonly number[], readonly lower: readonly number[] }
  readonly arms: Record<Side, ClearanceArm | null>
  readonly hips: number | null
  /** Vertex positions in mesh space, 3 per vertex. */
  readonly positions: ArrayLike<number>
  /** Up to four bone indices and weights per vertex. */
  readonly skinIndex: ArrayLike<number>
  readonly skinWeight: ArrayLike<number>
  /** The mesh's bind matrix, column-major. */
  readonly bindMatrix: ArrayLike<number>
  /** Corner vertex indices, 3 per triangle. */
  readonly triangles: ArrayLike<number>
  /** Material index per triangle. */
  readonly triangleMaterials: ArrayLike<number>
  readonly materials: readonly string[]
}

/** The triangles under test, with the compact vertex data the per-frame measure skins. */
export interface ClearanceAnalysis {
  /** Bind positions of the tested triangles' vertices (bind matrix applied), 3 per vertex. */
  readonly bind: Float64Array
  readonly skinIndex: Uint16Array
  /** Weights normalized to sum to 1. */
  readonly skinWeight: Float32Array
  /** Tested triangles as indices into `bind`, 3 per triangle. */
  readonly triangles: Uint32Array
  readonly classes: Uint8Array
  readonly materials: Uint16Array
  /** Each tested triangle's index in the source's triangle list. */
  readonly original: Uint32Array
  readonly materialNames: readonly string[]
  readonly arms: Record<Side, ClearanceArm | null>
  readonly hips: number | null
  /** The 90th percentile sleeve radius as a share of segment length, measured on the left arm. */
  readonly sleeve: { readonly upper: number, readonly fore: number }
  readonly counts: { readonly worn: number, readonly structural: number, readonly byClass: Record<ClearanceClass, number> }
}

type Region = 'arm' | 'head' | 'upper' | 'lower' | 'other'

/** The sleeve radius the arm guard assumes, used when an arm has too few vertices to measure. */
const DEFAULT_SLEEVE_RATIO = 0.12
/** A vertex with more arm-bone weight than this moves with the arm, so the arm wears it. */
const WORN_ARM_WEIGHT = 0.02
/** A vertex within this many sleeve radii of the bind-pose arm is a sleeve's junction or a cape over the arm. */
const WORN_SLEEVE_RADII = 1.25
/** The tested hand segment runs from the wrist this share of the forearm on when the rig has no middle finger. */
const BIND_HAND_REACH = 0.6

function regionsOf(source: ClearanceMeshSource): Region[] {
  const roots: [Region, ReadonlySet<number>][] = [
    ['arm', new Set(source.regionRoots.arm)],
    ['head', new Set(source.regionRoots.head)],
    ['upper', new Set(source.regionRoots.upper)],
    ['lower', new Set(source.regionRoots.lower)],
  ]
  return source.bones.map((_, start) => {
    const visited = new Set<number>()
    for (let bone = start; bone >= 0 && bone < source.bones.length && !visited.has(bone); bone = source.bones[bone].parent) {
      visited.add(bone)
      const match = roots.find(([, set]) => set.has(bone))
      if (match)
        return match[0]
    }
    return 'other'
  })
}

function dominantBones(source: ClearanceMeshSource): Int32Array {
  const count = source.positions.length / 3
  const dominant = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    let best = 0
    let bestWeight = -1
    for (let k = 0; k < 4; k++) {
      if (source.skinWeight[i * 4 + k] > bestWeight) {
        bestWeight = source.skinWeight[i * 4 + k]
        best = source.skinIndex[i * 4 + k]
      }
    }
    dominant[i] = best
  }
  return dominant
}

function vertexAt(source: ClearanceMeshSource, vertex: number): Point {
  return [source.positions[vertex * 3], source.positions[vertex * 3 + 1], source.positions[vertex * 3 + 2]]
}

/**
 * The sleeve radius of one arm segment: the 90th percentile distance of the arm's own vertices from the segment's axis,
 * over the middle 60 % of its length, as a share of its length.
 */
function sleeveRatio(source: ClearanceMeshSource, armVertex: (vertex: number) => boolean, from: Point, to: Point): number {
  const length = distance(from, to)
  if (length === 0)
    return DEFAULT_SLEEVE_RATIO
  const axis: Point = [(to[0] - from[0]) / length, (to[1] - from[1]) / length, (to[2] - from[2]) / length]
  const radii: number[] = []
  for (let i = 0; i < source.positions.length / 3; i++) {
    if (!armVertex(i))
      continue
    const p = vertexAt(source, i)
    const offset: Point = [p[0] - from[0], p[1] - from[1], p[2] - from[2]]
    const along = offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2]
    if (along < 0.2 * length || along > 0.8 * length)
      continue
    const radial = Math.hypot(offset[0] - along * axis[0], offset[1] - along * axis[1], offset[2] - along * axis[2])
    // Twist and helper bones carry the sleeve on many rigs; the other arm and hand props lie farther than a segment length.
    if (radial < length)
      radii.push(radial)
  }
  // Too few vertices to measure: the arm is bare or skinned elsewhere.
  return radii.length > 20 ? quantile(radii, 0.9) / length : DEFAULT_SLEEVE_RATIO
}

/** The bind-pose arm chain: shoulder, elbow, wrist, and the end of the hand. */
function bindChain(source: ClearanceMeshSource, arm: ClearanceArm): [Point, Point, Point, Point] {
  const [shoulder, elbow, wrist] = [arm.upper, arm.elbow, arm.wrist].map(bone => source.bones[bone].position)
  return [shoulder, elbow, wrist, lerp(elbow, wrist, 1 + BIND_HAND_REACH)]
}

/**
 * Classifies the mesh's triangles and drops the garments the arm wears: a triangle with a corner on an arm bone or on a
 * bone outside the body's regions, and one with a corner that the arm wears (arm-bone weight, or within 1.25 sleeve
 * radii of the bind-pose arm from the middle of the upper arm down). A triangle is cloth when two corners follow
 * simulated bones; its region is the head when two corners are, else the upper or lower body by majority.
 */
export function analyseClearanceMesh(source: ClearanceMeshSource): ClearanceAnalysis {
  const regions = regionsOf(source)
  const dominant = dominantBones(source)
  const vertexCount = source.positions.length / 3
  const chains = SIDES.map(side => source.arms[side] && bindChain(source, source.arms[side]))
  const left = chains[0]
  const sleeve = left
    ? {
        upper: sleeveRatio(source, vertex => regions[dominant[vertex]] === 'arm', left[0], left[1]),
        fore: sleeveRatio(source, vertex => regions[dominant[vertex]] === 'arm', left[1], left[2]),
      }
    : { upper: DEFAULT_SLEEVE_RATIO, fore: DEFAULT_SLEEVE_RATIO }

  const worn = new Uint8Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) {
    let armWeight = 0
    for (let k = 0; k < 4; k++) {
      if (regions[source.skinIndex[i * 4 + k]] === 'arm')
        armWeight += source.skinWeight[i * 4 + k]
    }
    if (armWeight > WORN_ARM_WEIGHT) {
      worn[i] = 1
      continue
    }
    const p = vertexAt(source, i)
    for (const chain of chains) {
      if (!chain)
        continue
      const upperReach = WORN_SLEEVE_RADII * sleeve.upper * distance(chain[0], chain[1])
      const foreReach = WORN_SLEEVE_RADII * sleeve.fore * distance(chain[1], chain[2])
      // The upper half of the upper arm lies against the chest, so the rule starts where the tested chain starts.
      if (segmentDistance(p, lerp(chain[0], chain[1], 0.5), chain[1]) < upperReach || segmentDistance(p, chain[1], chain[2]) < foreReach || segmentDistance(p, chain[2], chain[3]) < foreReach)
        worn[i] = 1
    }
  }

  const remap = new Int32Array(vertexCount).fill(-1)
  const used: number[] = []
  const triangles: number[] = []
  const classes: number[] = []
  const materials: number[] = []
  const original: number[] = []
  let wornTriangles = 0
  for (let t = 0; t < source.triangles.length / 3; t++) {
    const corners = [source.triangles[t * 3], source.triangles[t * 3 + 1], source.triangles[t * 3 + 2]]
    const cornerRegions = corners.map(corner => regions[dominant[corner]])
    if (cornerRegions.includes('arm') || cornerRegions.includes('other'))
      continue
    if (corners.some(corner => worn[corner])) {
      wornTriangles++
      continue
    }
    const cloth = corners.filter(corner => source.bones[dominant[corner]].simulated).length >= 2
    const count = (region: Region) => cornerRegions.filter(r => r === region).length
    let cls: number
    if (count('head') >= 2)
      cls = cloth ? 5 : 4
    else if (count('upper') >= count('lower'))
      cls = cloth ? 1 : 0
    else
      cls = cloth ? 3 : 2
    for (const corner of corners) {
      if (remap[corner] < 0) {
        remap[corner] = used.length
        used.push(corner)
      }
      triangles.push(remap[corner])
    }
    classes.push(cls)
    materials.push(source.triangleMaterials[t])
    original.push(t)
  }

  const m = source.bindMatrix
  const bind = new Float64Array(used.length * 3)
  const skinIndex = new Uint16Array(used.length * 4)
  const skinWeight = new Float32Array(used.length * 4)
  used.forEach((vertex, i) => {
    const [x, y, z] = vertexAt(source, vertex)
    bind[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]
    bind[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
    bind[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
    let total = 0
    for (let k = 0; k < 4; k++)
      total += source.skinWeight[vertex * 4 + k]
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = source.skinIndex[vertex * 4 + k]
      skinWeight[i * 4 + k] = source.skinWeight[vertex * 4 + k] / (total || 1)
    }
  })
  const classArray = Uint8Array.from(classes)
  return {
    bind,
    skinIndex,
    skinWeight,
    triangles: Uint32Array.from(triangles),
    classes: classArray,
    materials: Uint16Array.from(materials),
    original: Uint32Array.from(original),
    materialNames: source.materials,
    arms: source.arms,
    hips: source.hips,
    sleeve,
    counts: { worn: wornTriangles, structural: 0, byClass: classCounts(classArray) },
  }
}

function classCounts(classes: Uint8Array): Record<ClearanceClass, number> {
  const counts: Record<ClearanceClass, number> = { 'upper-rigid': 0, 'upper-cloth': 0, 'lower-rigid': 0, 'lower-cloth': 0, 'head-rigid': 0, 'hair': 0 }
  classes.forEach(cls => counts[CLEARANCE_CLASSES[cls]]++)
  return counts
}

/**
 * Drops the structural crossings: triangles that the arm's centreline crosses with the arms in the bind pose and the
 * cloth settled, where the arm is clear of her body by construction, so they belong to a garment the arm wears (a coat
 * hung from the elbows). Only the crossed triangles leave the test. `crossed` holds source triangle indices.
 */
export function withoutStructural(analysis: ClearanceAnalysis, crossed: ReadonlySet<number>): ClearanceAnalysis {
  if (!crossed.size)
    return analysis
  const keep: number[] = []
  for (let t = 0; t < analysis.classes.length; t++) {
    if (!crossed.has(analysis.original[t]))
      keep.push(t)
  }
  const classes = Uint8Array.from(keep.map(t => analysis.classes[t]))
  return {
    ...analysis,
    triangles: Uint32Array.from(keep.flatMap(t => [analysis.triangles[t * 3], analysis.triangles[t * 3 + 1], analysis.triangles[t * 3 + 2]])),
    classes,
    materials: Uint16Array.from(keep.map(t => analysis.materials[t])),
    original: Uint32Array.from(keep.map(t => analysis.original[t])),
    counts: { ...analysis.counts, structural: analysis.classes.length - keep.length, byClass: classCounts(classes) },
  }
}

/**
 * Refuses a model the measure cannot judge: without an arm chain or without a body triangle to test, every frame would
 * read as unpierced, and a sweep would pass a rig it never measured.
 */
export function requireMeasurable(analysis: ClearanceAnalysis): ClearanceAnalysis {
  if (!analysis.arms.left && !analysis.arms.right)
    throw new Error('the clearance measure found no arm with an elbow and a wrist on this model')
  // Head and hair crossings are reported by class and never count as pierced, so they are no measure by themselves.
  if (!analysis.classes.some(cls => PIERCED_CLASSES.has(cls)))
    throw new Error('the clearance measure found no body triangle to test on this model')
  return analysis
}
