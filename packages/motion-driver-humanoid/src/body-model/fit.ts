import type { BodyBone, BodyCollider, BodySide } from '../performance'
import type { Vec3 } from '../types'
import type { BodyMeshSource, BodyModelAdjustment } from './contracts'

import { SIDES } from '../performance/channels'

/**
 * A simulated component this many bones deep or less can be flesh. On the 32 library rigs (2026-11-24) the flesh on
 * simulated bones is the chest, one or two bones a side; skirts, coats and ribbons are chains of three bones or more.
 */
const FLESH_CHAIN_MAX = 2
/**
 * Flesh moves at most this share of the shoulder span. The chest bones of the library rigs have joint limits of 25 to
 * 30 degrees, a mobility of 0.10 to 0.35 of the span. A deeper chain is a garment whatever its limits: the Wuthering
 * Waves rigs lock every cloth joint (mobility 0) and the cloth still trails, because the simulator's joints are soft.
 */
const FLESH_MOBILITY_MAX = 0.5
/**
 * The trunk is fitted down to this share of the arm's reach (upper arm, forearm and the hand's 0.65 of the forearm)
 * below the shoulders. Lower geometry is out of a hanging hand's reach.
 */
const ARM_REACH = 1.15
const HAND_EXTENSION = 0.65
/** Height slices from the reach line to the shoulders. */
const TRUNK_SLICES = 10
/** A slice spans its vertices between this quantile and its complement, so a stray vertex does not widen it. */
const SLICE_QUANTILE = 0.01
/** A slice with fewer vertices has no surface worth a volume. */
const SLICE_VERTICES_MIN = 12
/**
 * Rule 5: beside the upper arm, from the shoulders down to an upper arm's length below them, a hard volume ends this
 * share of the upper arm inside each shoulder joint. The arm test's capsule has a radius of 0.15 of its segment and a
 * margin of 0.03, so an upper arm that hangs straight down or rises straight up from its joint clears the trunk it is
 * attached to. What a bind pose holds outside the joints at that height is not something a hanging arm can clear: the
 * rim of the armhole, which the mesh stretches toward the raised arm, or an ornament that widens the slice. On Chisa
 * (2026-11-25) 17 of the 1,667 vertices of the slice under the armpit lie on that rim, 0.24 units outside the joint;
 * with the rule ending at the armpit they widened the slice by 0.3 units, the resting arm sat on it, and every arm form
 * of the performer was refused, because its path from the rest arm entered the volume by 0.004 arm lengths.
 */
const UPPER_ARM_DROP = 1
const SHOULDER_INSET = 0.18
/**
 * A garment's rest shape is narrowed down to the armpit only, half an upper arm below the shoulders, where the arm test
 * starts. Below it the shape keeps the width of the cloth: a coat does hang outside the shoulder joints, and rules 7 and
 * 8 ask where it hangs.
 */
const ARMPIT_DROP = 0.5
/** A limb's radius is this quantile of its own vertices' distance from the bone, between these shares of its length. */
const LIMB_RADIUS_QUANTILE = 0.9
const LIMB_SAMPLE_FROM = 0.2
const LIMB_SAMPLE_TO = 0.8
const LIMB_VERTICES_MIN = 20
/** Without enough vertices an arm segment takes the arm test's own radius, 0.15 of the segment. */
const LIMB_RADIUS_DEFAULT = 0.15
/**
 * Rule 2: a vertex within this many limb radii of the bind-pose arm, from the middle of the upper arm down, is something
 * the arm wears. 1.25 is what the arm clearance measure uses; the sleeve's 90th percentile leaves its seams outside 1.
 */
const WORN_REACH = 1.25

const SPINE_BONES = ['spine0', 'spine1', 'spine2', 'spine3'] as const
/** The canonical bones of the trunk, which carry the slices and the garments. A segment code below `NECK` indexes them. */
const TRUNK: readonly BodyBone[] = ['hips', ...SPINE_BONES]
const HIPS = 0
/**
 * Segment codes after the trunk: the neck and the head, each arm, each thigh, and bones that ride on nothing canonical.
 * The neck and the head get no volume. A hand goes to the face, the chin and the hair there, and one sphere on the head
 * serves none of those; a head fitted to the skull, the jaw and the face is a later reader of the mesh. Until then a
 * host keeps the bodies it has for the head and the neck.
 */
const NECK = 5
const HEAD = 6
const ARM = { left: 7, right: 8 } as const
const THIGH = { left: 9, right: 10 } as const
const SHIN = { left: 11, right: 12 } as const
const NONE = 13

/** A capsule's axis is its local Y: a roll lays it left to right, a pitch front to back. */
const SLICE_ACROSS = Object.freeze({ yaw: 0, pitch: 0, roll: Math.PI / 2 })
const SLICE_ALONG = Object.freeze({ yaw: 0, pitch: Math.PI / 2, roll: 0 })

export interface FittedGarment {
  readonly bones: readonly number[]
  readonly anchor: BodyBone
  readonly silhouette: readonly BodyCollider[]
  readonly mobility: number
  /** The simulator collides some bone of the garment with an arm (`BodyMeshSimulatedBone.collidesWithArm`). */
  readonly collidesWithArm: boolean
}

export interface BodyFit {
  readonly volumes: readonly BodyCollider[]
  readonly garments: readonly FittedGarment[]
  readonly limbs: Record<BodySide, { upperArm: number, forearm: number }>
  readonly vertices: { hard: number, flesh: number, garment: number, arm: number, ignored: number }
  /** Rule 5's narrowings; `volume` indexes `volumes`, or is -1 for a slice that ended between the shoulders. */
  readonly adjustments: readonly BodyModelAdjustment[]
}

interface SliceBin {
  readonly xs: number[]
  readonly zs: number[]
  /** Vertices per trunk bone, to attach the slice to the bone that carries most of it. */
  readonly owners: Uint32Array
}

interface SliceFrame {
  readonly bottom: number
  readonly top: number
  readonly bins: readonly SliceBin[]
}

function sliceFrame(bottom: number, top: number, count: number): SliceFrame {
  return { bottom, top, bins: Array.from({ length: count }, () => ({ xs: [], zs: [], owners: new Uint32Array(TRUNK.length) })) }
}

function addToSlice(frame: SliceFrame, x: number, y: number, z: number, owner: number): void {
  if (y < frame.bottom || y >= frame.top)
    return
  const bin = frame.bins[Math.min(frame.bins.length - 1, Math.floor((y - frame.bottom) / (frame.top - frame.bottom) * frame.bins.length))]
  bin.xs.push(x)
  bin.zs.push(z)
  bin.owners[owner]++
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))]
}

function distanceToSegment(px: number, py: number, pz: number, a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  const length = dx * dx + dy * dy + dz * dz
  const u = length > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy + (pz - a.z) * dz) / length)) : 0
  return Math.hypot(px - a.x - u * dx, py - a.y - u * dy, pz - a.z - u * dz)
}

const distance = (a: Readonly<Vec3>, b: Readonly<Vec3>) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const lerp = (a: Readonly<Vec3>, b: Readonly<Vec3>, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })

/**
 * Fits the hard volumes, the garments' rest shapes and the limb radii to the bind-pose mesh (README rules 1 to 5). It
 * reads no authored rigid body's shape, takes no time or random input, and visits vertices and bones in index order, so
 * the same source gives the same fit.
 */
export function fitBody(source: BodyMeshSource): BodyFit {
  const { bones, canonical, positions, skinIndices, skinWeights, triangles } = source
  const vertexCount = Math.floor(positions.length / 3)
  const at = (bone: number) => bones[bone].position

  // Each bone's segment: the nearest canonical bone it moves with.
  const segments = new Uint8Array(bones.length).fill(NONE)
  const assigned = new Uint8Array(bones.length)
  const seed = (bone: number | null, segment: number) => {
    if (bone !== null && bone >= 0 && bone < bones.length && !assigned[bone]) {
      segments[bone] = segment
      assigned[bone] = 1
    }
  }
  seed(canonical.hips, HIPS)
  canonical.spine.forEach((bone, index) => seed(bone, 1 + index))
  seed(canonical.neck, NECK)
  seed(canonical.head, HEAD)
  for (const side of SIDES) {
    seed(canonical.arms[side].clavicle, ARM[side])
    seed(canonical.arms[side].upper, ARM[side])
    if (canonical.legs) {
      seed(canonical.legs[side].upper, THIGH[side])
      seed(canonical.legs[side].lower, SHIN[side])
    }
  }
  const path: number[] = []
  for (let bone = 0; bone < bones.length; bone++) {
    path.length = 0
    let current = bone
    // A cycle ends at the first bone seen twice, which then rides on nothing.
    while (current >= 0 && current < bones.length && !assigned[current] && !path.includes(current)) {
      path.push(current)
      current = bones[current].parent
    }
    const segment = current >= 0 && current < bones.length && assigned[current] ? segments[current] : NONE
    for (const visited of path) {
      segments[visited] = segment
      assigned[visited] = 1
    }
  }

  const shoulders = { left: at(canonical.arms.left.upper), right: at(canonical.arms.right.upper) }
  const span = distance(shoulders.left, shoulders.right)

  // Simulated bones: flesh, or a chain of a garment under the unsimulated bone it hangs from.
  const mobility = new Float64Array(bones.length).fill(Number.NaN)
  const collidesWithArm = new Uint8Array(bones.length)
  for (const entry of source.simulated) {
    mobility[entry.bone] = entry.mobility
    collidesWithArm[entry.bone] = entry.collidesWithArm ? 1 : 0
  }
  const simulated = (bone: number) => bone >= 0 && bone < bones.length && !Number.isNaN(mobility[bone])
  const hanger = new Int32Array(bones.length).fill(-1)
  const root = new Int32Array(bones.length).fill(-1)
  const componentDepth = new Uint16Array(bones.length)
  const componentMobility = new Float64Array(bones.length)
  for (let bone = 0; bone < bones.length; bone++) {
    if (!simulated(bone))
      continue
    let current = bone
    let steps = 0
    while (simulated(bones[current].parent) && steps < bones.length) {
      current = bones[current].parent
      steps++
    }
    root[bone] = current
    hanger[bone] = bones[current].parent
    componentDepth[current] = Math.max(componentDepth[current], steps + 1)
    componentMobility[current] = Math.max(componentMobility[current], mobility[bone])
  }
  const isFlesh = (bone: number) => componentDepth[root[bone]] <= FLESH_CHAIN_MAX && componentMobility[root[bone]] <= FLESH_MOBILITY_MAX * span
  /** A garment hangs from the trunk: the hips or a spine bone. Hair, sleeves and what hangs from a leg are not fitted. */
  const inGarment = (bone: number) => simulated(bone) && !isFlesh(bone) && segments[bone] < NECK

  // Pass 1: each vertex's dominant bone and arm weight, and the arms' own radii.
  const dominant = new Int32Array(vertexCount)
  const onArm = new Uint8Array(vertexCount)
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    // A vertex without a place has no bone: it joins no slice and no limb, and counts as ignored.
    if (!Number.isFinite(positions[vertex * 3]) || !Number.isFinite(positions[vertex * 3 + 1]) || !Number.isFinite(positions[vertex * 3 + 2])) {
      dominant[vertex] = -1
      continue
    }
    let best = -1
    let bestWeight = 0
    for (let k = 0; k < 4; k++) {
      const weight = skinWeights[vertex * 4 + k]
      const bone = skinIndices[vertex * 4 + k]
      if (!(weight > 0) || bone < 0 || bone >= bones.length)
        continue
      if (segments[bone] === ARM.left || segments[bone] === ARM.right)
        onArm[vertex] = 1
      if (weight > bestWeight) {
        bestWeight = weight
        best = bone
      }
    }
    dominant[vertex] = best
  }

  // A garment is one piece (`BodyGarment`): the chains of one hanger that the mesh or the skeleton ties. The mesh ties
  // two chains when a triangle has corners on both; a corner sits on the chain of its vertex's dominant bone. The
  // lowest root names a piece.
  const piece = new Int32Array(bones.length)
  for (let bone = 0; bone < bones.length; bone++)
    piece[bone] = bone
  const pieceOf = (chain: number) => {
    while (piece[chain] !== chain) {
      piece[chain] = piece[piece[chain]]
      chain = piece[chain]
    }
    return chain
  }
  const chainOf = (vertex: number) => vertex >= 0 && vertex < vertexCount && dominant[vertex] >= 0 && inGarment(dominant[vertex]) ? root[dominant[vertex]] : -1
  const tie = (a: number, b: number) => {
    if (a < 0 || b < 0 || hanger[a] !== hanger[b])
      return
    const first = pieceOf(a)
    const second = pieceOf(b)
    piece[Math.max(first, second)] = Math.min(first, second)
  }
  for (let corner = 0; corner + 2 < triangles.length; corner += 3) {
    const first = chainOf(triangles[corner])
    const second = chainOf(triangles[corner + 1])
    const third = chainOf(triangles[corner + 2])
    tie(first, second)
    tie(second, third)
    tie(first, third)
  }
  // The skeleton ties the chains under a bone of the author's own. The hips and the spine carry everything.
  const ownHanger = (bone: number) => bone !== canonical.hips && !canonical.spine.includes(bone)
  const firstChain = new Map<number, number>()
  for (let bone = 0; bone < bones.length; bone++) {
    if (root[bone] !== bone || !inGarment(bone) || !ownHanger(hanger[bone]))
      continue
    tie(bone, firstChain.get(hanger[bone]) ?? bone)
    if (!firstChain.has(hanger[bone]))
      firstChain.set(hanger[bone], bone)
  }
  const garmentOf = new Map<number, { bones: number[], anchor: number, frame: SliceFrame | null, mobilities: number[] }>()
  const garmentKey = new Int32Array(bones.length).fill(-1)
  for (let bone = 0; bone < bones.length; bone++) {
    if (!inGarment(bone))
      continue
    const key = pieceOf(root[bone])
    garmentKey[bone] = key
    const garment = garmentOf.get(key) ?? { bones: [], anchor: segments[bone], frame: null, mobilities: [] }
    garment.bones.push(bone)
    garmentOf.set(key, garment)
  }
  const arms = SIDES.map((side) => {
    const arm = canonical.arms[side]
    const shoulder = at(arm.upper)
    const elbow = at(arm.lower)
    const wrist = at(arm.hand)
    return { side, shoulder, elbow, wrist, middle: lerp(shoulder, elbow, 0.5), tip: lerp(elbow, wrist, 1 + HAND_EXTENSION), upperLength: distance(shoulder, elbow), forearmLength: distance(elbow, wrist) }
  })
  /** `hardOnly` leaves out what a garment bone carries: a sleeve belongs to the arm, a ribbon does not thicken a thigh. */
  const limbRadius = (from: Readonly<Vec3>, to: Readonly<Vec3>, segment: number, hardOnly: boolean): number | null => {
    const length = distance(from, to)
    const radial: number[] = []
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const bone = dominant[vertex]
      if (bone < 0 || segments[bone] !== segment || (hardOnly && simulated(bone) && !isFlesh(bone)))
        continue
      const x = positions[vertex * 3] - from.x
      const y = positions[vertex * 3 + 1] - from.y
      const z = positions[vertex * 3 + 2] - from.z
      const along = (x * (to.x - from.x) + y * (to.y - from.y) + z * (to.z - from.z)) / (length * length)
      if (along < LIMB_SAMPLE_FROM || along > LIMB_SAMPLE_TO)
        continue
      const away = Math.hypot(x - along * (to.x - from.x), y - along * (to.y - from.y), z - along * (to.z - from.z))
      // The other limb and what a hand holds are farther than a segment length.
      if (away < length)
        radial.push(away)
    }
    if (radial.length < LIMB_VERTICES_MIN)
      return null
    radial.sort((a, b) => a - b)
    return quantile(radial, LIMB_RADIUS_QUANTILE) / length
  }
  const limbs = {
    left: { upperArm: limbRadius(arms[0].shoulder, arms[0].elbow, ARM.left, false) ?? LIMB_RADIUS_DEFAULT, forearm: limbRadius(arms[0].elbow, arms[0].wrist, ARM.left, false) ?? LIMB_RADIUS_DEFAULT },
    right: { upperArm: limbRadius(arms[1].shoulder, arms[1].elbow, ARM.right, false) ?? LIMB_RADIUS_DEFAULT, forearm: limbRadius(arms[1].elbow, arms[1].wrist, ARM.right, false) ?? LIMB_RADIUS_DEFAULT },
  }

  // Pass 2: sort every vertex into the arm, the hard surface, a garment, or nothing.
  const shoulderY = (shoulders.left.y + shoulders.right.y) / 2
  const reach = Math.max(...arms.map(arm => arm.upperLength + (1 + HAND_EXTENSION) * arm.forearmLength))
  const bottom = shoulderY - ARM_REACH * reach
  const trunk = sliceFrame(bottom, shoulderY, TRUNK_SLICES)
  const vertices = { hard: 0, flesh: 0, garment: 0, arm: 0, ignored: 0 }
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const bone = dominant[vertex]
    const x = positions[vertex * 3]
    const y = positions[vertex * 3 + 1]
    const z = positions[vertex * 3 + 2]
    let worn = onArm[vertex] === 1
    for (let i = 0; i < arms.length && !worn; i++) {
      const arm = arms[i]
      const upper = WORN_REACH * limbs[arm.side].upperArm * arm.upperLength
      const fore = WORN_REACH * limbs[arm.side].forearm * arm.forearmLength
      worn = distanceToSegment(x, y, z, arm.middle, arm.elbow) < upper || distanceToSegment(x, y, z, arm.elbow, arm.tip) < fore
    }
    if (worn) {
      vertices.arm++
      continue
    }
    if (bone < 0 || segments[bone] === NONE) {
      vertices.ignored++
      continue
    }
    const segment = segments[bone]
    if (simulated(bone) && !isFlesh(bone)) {
      const garment = garmentOf.get(garmentKey[bone])
      if (!garment) {
        vertices.ignored++
        continue
      }
      vertices.garment++
      garment.mobilities.push(mobility[bone])
      garment.frame ??= sliceFrame(bottom, shoulderY, TRUNK_SLICES)
      addToSlice(garment.frame, x, y, z, garment.anchor)
      continue
    }
    if (simulated(bone))
      vertices.flesh++
    else
      vertices.hard++
    // The trunk is sliced below the shoulders. What the spine carries above them is the top of the shoulders, between
    // the joints the arms turn about. The neck and the head get no volume: a host keeps its own bodies for them.
    if (segment < NECK && y < shoulderY)
      addToSlice(trunk, x, y, z, segment)
  }
  const anchors: readonly Readonly<Vec3>[] = [at(canonical.hips), ...SPINE_BONES.map((_, index) => at(canonical.spine[Math.min(index, canonical.spine.length - 1)]))]
  const upperLength = Math.min(arms[0].upperLength, arms[1].upperLength)
  const lowerShoulderY = Math.min(shoulders.left.y, shoulders.right.y)
  const innerLeft = shoulders.left.x - SHOULDER_INSET * upperLength
  const innerRight = shoulders.right.x + SHOULDER_INSET * upperLength
  const adjustments: BodyModelAdjustment[] = []
  /**
   * One capsule a slice, as deep and as wide as the slice (rule 4) and inside the shoulder joints (rule 5). A hard
   * volume (`fixedOwner` null) is narrowed down to the elbow of a hanging arm and lies along the longer of its two
   * extents, so a slice that is deeper than it is wide keeps its depth. A garment's rest shape (`fixedOwner` its
   * anchor) is narrowed down to the armpit and lies left to right: the bounds of rules 7 and 8 were measured on those
   * shapes.
   */
  const capsules = (frame: SliceFrame, fixedOwner: number | null, out: BodyCollider[]): void => {
    const hard = fixedOwner === null
    const height = (frame.top - frame.bottom) / frame.bins.length
    // A hard slice is beside the upper arm when its middle is above the elbow; a garment's when its top is above the armpit.
    const narrowedAbove = hard ? lowerShoulderY - UPPER_ARM_DROP * upperLength : lowerShoulderY - ARMPIT_DROP * upperLength - height / 2
    frame.bins.forEach((bin, index) => {
      if (bin.xs.length < SLICE_VERTICES_MIN)
        return
      bin.xs.sort((a, b) => a - b)
      bin.zs.sort((a, b) => a - b)
      const fittedLeft = quantile(bin.xs, 1 - SLICE_QUANTILE)
      const fittedRight = quantile(bin.xs, SLICE_QUANTILE)
      let left = fittedLeft
      let right = fittedRight
      const y = frame.bottom + (index + 0.5) * height
      if (y > narrowedAbove) {
        left = Math.min(left, innerLeft)
        right = Math.max(right, innerRight)
      }
      const back = quantile(bin.zs, SLICE_QUANTILE)
      const front = quantile(bin.zs, 1 - SLICE_QUANTILE)
      const width = left - right
      const depth = front - back
      const radius = Math.min(depth, width) / 2
      const along = hard && depth > width
      let owner = fixedOwner ?? 0
      if (hard) {
        for (let k = 1; k < bin.owners.length; k++) {
          if (bin.owners[k] > bin.owners[owner])
            owner = k
        }
      }
      const narrowed = left !== fittedLeft || right !== fittedRight
      if (!(radius > 0)) {
        if (hard && narrowed)
          adjustments.push({ volume: -1, bone: TRUNK[owner], scale: 0, reason: 'shoulder-joints' })
        return
      }
      if (hard && narrowed)
        adjustments.push({ volume: out.length, bone: TRUNK[owner], scale: width / (fittedLeft - fittedRight), reason: 'shoulder-joints' })
      const anchor = anchors[owner]
      out.push({
        bone: TRUNK[owner],
        shape: 'capsule',
        radius,
        length: Math.max(0, (along ? depth : width) - 2 * radius),
        centre: { x: (left + right) / 2 - anchor.x, y: y - anchor.y, z: (back + front) / 2 - anchor.z },
        rotation: along ? SLICE_ALONG : SLICE_ACROSS,
      })
    })
  }
  const volumes: BodyCollider[] = []
  capsules(trunk, null, volumes)

  // Rule 4: a limb gets a capsule along its bone. Only the thighs are in a hand's reach.
  if (canonical.legs) {
    const hips = at(canonical.hips)
    for (const side of SIDES) {
      const hip = at(canonical.legs[side].upper)
      const knee = at(canonical.legs[side].lower)
      const length = distance(hip, knee)
      const radius = length > 0 ? limbRadius(hip, knee, THIGH[side], true) : null
      // A leg the mesh does not cover has no surface to clear.
      if (radius === null)
        continue
      const dx = hip.x - knee.x
      const dy = hip.y - knee.y
      const dz = hip.z - knee.z
      volumes.push({
        bone: 'hips',
        shape: 'capsule',
        radius: radius * length,
        length,
        centre: { x: (hip.x + knee.x) / 2 - hips.x, y: (hip.y + knee.y) / 2 - hips.y, z: (hip.z + knee.z) / 2 - hips.z },
        rotation: { yaw: 0, pitch: Math.atan2(dz, dy), roll: -Math.atan2(dx, Math.hypot(dy, dz)) },
        leg: { side, segment: 'thigh' },
      })
    }
  }

  // By the bone they hang from, then by their lowest chain.
  const garments: FittedGarment[] = [...garmentOf.entries()].sort((a, b) => hanger[a[0]] - hanger[b[0]] || a[0] - b[0]).map(([, garment]) => {
    const silhouette: BodyCollider[] = []
    if (garment.frame)
      capsules(garment.frame, garment.anchor, silhouette)
    // The median over the garment's vertices: what most of its cloth can do, whatever a stiff waistband or a free hem does.
    garment.mobilities.sort((a, b) => a - b)
    return {
      bones: garment.bones,
      anchor: TRUNK[garment.anchor],
      silhouette,
      mobility: garment.mobilities.length ? quantile(garment.mobilities, 0.5) : 0,
      collidesWithArm: garment.bones.some(bone => collidesWithArm[bone] === 1),
    }
  })
  return { volumes, garments, limbs, vertices, adjustments }
}
