import type { BodyBone, BodyCollider, BodySide } from '../performance'
import type { Vec3 } from '../types'

/** One bone of the mesh's skeleton, by its index in `BodyMeshSource.bones`. */
export interface BodyMeshBone {
  /**
   * The bone this bone moves with, or -1: its skeleton parent, or, for a helper that copies another bone's rotation in
   * full (an MMD deform bone), the bone it copies. The model reads no other hierarchy.
   */
  readonly parent: number
  /** Bind position in model units: +X her left, +Y up, +Z forward. */
  readonly position: Readonly<Vec3>
}

export interface BodyMeshArm {
  readonly clavicle: number | null
  readonly upper: number
  readonly lower: number
  readonly hand: number
}

export interface BodyMeshLeg {
  readonly upper: number
  readonly lower: number
  readonly foot: number
}

/** A bone the secondary-motion simulator moves, not the pose. */
export interface BodyMeshSimulatedBone {
  readonly bone: number
  /**
   * The farthest the simulator's joint limits let it carry the bone from its bind place, relative to its nearest
   * unsimulated ancestor, in model units. Infinity when no limit bounds it.
   */
  readonly mobility: number
  /**
   * The simulator collides this bone with an arm: its collision filter lets some body this bone carries touch some body
   * that follows an arm bone.
   */
  readonly collidesWithArm: boolean
}

/**
 * What the body model is built from: a skinned mesh in its bind pose, the skeleton, and which bones are simulated. It
 * names no renderer type, so an MMD and a VRM adapter fill the same source. Axes and units are `BodyRigTraits`'.
 */
export interface BodyMeshSource {
  /** Bind-pose vertex positions, three numbers a vertex. */
  readonly positions: ArrayLike<number>
  /** Four bone indices and four weights a vertex; an unused slot has weight 0. */
  readonly skinIndices: ArrayLike<number>
  readonly skinWeights: ArrayLike<number>
  /**
   * The mesh's triangles, three vertex indices each. They say which simulated chains carry one piece of the mesh, which
   * makes them one garment (`BodyGarment`).
   */
  readonly triangles: ArrayLike<number>
  readonly bones: readonly BodyMeshBone[]
  readonly canonical: {
    readonly hips: number
    /** Lower to upper; one to four bones, as `BodyRigTraits.spineChain`. */
    readonly spine: readonly number[]
    readonly neck: number
    readonly head: number
    readonly arms: Readonly<Record<BodySide, BodyMeshArm>>
    /** Null when either leg is missing; then leg geometry stays with the hips. */
    readonly legs: Readonly<Record<BodySide, BodyMeshLeg>> | null
  }
  readonly simulated: readonly BodyMeshSimulatedBone[]
}

/**
 * A soft garment: one piece of simulated geometry that hangs from the trunk.
 *
 * A simulated chain is a simulated bone under an unsimulated one, its hanger, with the simulated bones below it. The
 * chains of one garment hang from the same bone, and the mesh or the skeleton ties them:
 *
 * - Under the hips or a spine bone, which carry everything, two chains are one garment when a triangle has corners on
 *   both, or on chains tied to both. The strips of a skirt are one garment, and a bow that hangs from the same bone and
 *   shares no triangle with the skirt is another. A chain that carries no vertex is a garment of its own without a rest
 *   shape.
 * - Under any other bone, all the chains are one garment: the author gave them a bone of their own to hang from.
 */
export interface BodyGarment {
  /** The simulated bones that carry it, as indices into `BodyMeshSource.bones`, ascending. */
  readonly bones: readonly number[]
  /** The canonical bone it hangs from. */
  readonly anchor: BodyBone
  /** Its shape in the bind pose, as colliders on `anchor`. The simulator moves the garment away from this shape. */
  readonly silhouette: readonly BodyCollider[]
  /** The mobility of the simulated bones that carry most of it: the median over its vertices, in model units. */
  readonly mobility: number
  /**
   * The centreline of a resting arm lies inside the rest shape of this free-swinging garment at the model's rest
   * (`BodyModel.rest`); README rule 7 says when the solve leaves an arm there. Cloth that swings cannot get out from
   * around an arm that rests inside it; it bounces on the arm. A host must not let this garment collide with the arms.
   */
  readonly pinched: boolean
}

/**
 * What kept a resting arm from clearing everything.
 *
 * - `volume`: a hard volume no rest abduction cleared, so it shrank. `index` points into `BodyModel.volumes`, or is null
 *   when the solve dropped the volume, which then is in no list. `BodyModelReport.adjustments` holds every shrunk and
 *   dropped volume with its bone and its scale.
 * - `garment`: a garment whose rest shape the arm still overlaps. `index` points into `BodyModel.garments`.
 */
export type BodyRestLimit
  = | { readonly kind: 'volume', readonly index: number | null }
    | { readonly kind: 'garment', readonly index: number }

export interface BodyRestClearance {
  /** The rest abduction, radians from a straight-down arm: the `BODY_CHANNELS` abduction of this side at rest. */
  readonly abduct: number
  /** Null when the resting arm clears every hard volume as fitted and every garment's rest shape. */
  readonly limit: BodyRestLimit | null
}

export interface BodyModelAdjustment {
  /** Index into `BodyModel.volumes`, or -1 for a volume that was dropped. */
  readonly volume: number
  readonly bone: BodyBone
  /** The share of its fitted size the volume kept; 0 when dropped. */
  readonly scale: number
  /** `shoulder-joints`: rule 5 narrowed it between the shoulders. `rest-clearance`: no rest abduction cleared it. */
  readonly reason: 'shoulder-joints' | 'rest-clearance'
}

export interface BodyModelReport {
  /**
   * Vertices by what the fit took them for. `ignored` ride on no canonical bone, or on simulated bones of the head or
   * the arms, or have a position that is not finite.
   */
  readonly vertices: { readonly hard: number, readonly flesh: number, readonly garment: number, readonly arm: number, readonly ignored: number }
  readonly adjustments: readonly BodyModelAdjustment[]
}

/**
 * Where her body, her rigid clothing and her soft garments are, built once from a `BodyMeshSource`.
 *
 * `volumes` are the hard obstacles from the hips to the shoulders and on the thighs: body, rigid clothing, and flesh on
 * simulated bones. The neck and the head have none; a host adds the bodies it has for them. A leg volume keeps the hips
 * as its bone and carries `leg`, as `BodyCollider` documents. `limbs` is each arm segment's measured radius as a share
 * of its length.
 */
export interface BodyModel {
  readonly volumes: readonly BodyCollider[]
  readonly garments: readonly BodyGarment[]
  readonly limbs: Readonly<Record<BodySide, { readonly upperArm: number, readonly forearm: number }>>
  readonly rest: Readonly<Record<BodySide, BodyRestClearance>>
  readonly report: BodyModelReport
}
