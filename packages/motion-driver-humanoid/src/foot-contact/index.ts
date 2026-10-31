import type { RigTraits, Vec3 } from '../types'

export type Foot = 'left' | 'right'

export interface FootAnchor {
  readonly position: Vec3
  /** Mesh-local yaw in radians. */
  readonly yaw: number
}

export interface LegGeometry {
  readonly hip: Vec3
  readonly knee: Vec3
  readonly ankle: Vec3
}

export interface FootSample extends FootAnchor {
  readonly clipFootTrackWeight: number
  readonly kneeAnimated: boolean
}

export interface FootContactInput {
  /** Requested translation from the bind hips, in mesh-local model units. */
  readonly pelvisOffset: Vec3
  /** Last solved ankles, not this frame's unsolved pose. */
  readonly feet: Record<Foot, FootSample>
  readonly enabled: boolean
  readonly duck: number
}

interface ContactState {
  anchor: FootAnchor
  c: number
  desired: number
  start: number
  elapsed: number
}

const sides = ['left', 'right'] as const

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function blend(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function blendAnchor(a: FootAnchor, b: FootAnchor, t: number): FootAnchor {
  return {
    position: {
      x: blend(a.position.x, b.position.x, t),
      y: blend(a.position.y, b.position.y, t),
      z: blend(a.position.z, b.position.z, t),
    },
    yaw: a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * t,
  }
}

/** Owns contact envelopes and planted anchors for one rig. Time is explicit seconds. */
class FootContact {
  private readonly contacts: Record<Foot, ContactState>
  private readonly lengths: Record<Foot, number>
  private drop = 0

  constructor(private readonly options: {
    readonly legs: Record<Foot, LegGeometry>
    readonly traits: Pick<RigTraits, 'footBaselineY' | 'kneeBendSign'>
  }) {
    const contact = (leg: LegGeometry): ContactState => ({
      anchor: { position: { ...leg.ankle }, yaw: 0 },
      c: 0,
      desired: 0,
      start: 0,
      elapsed: 0,
    })
    this.contacts = { left: contact(options.legs.left), right: contact(options.legs.right) }
    const length = (leg: LegGeometry) => distance(leg.hip, leg.knee) + distance(leg.knee, leg.ankle)
    this.lengths = { left: length(options.legs.left), right: length(options.legs.right) }
  }

  /** Re-bases the planted anchors, for example after root motion or a gait hand-back. Contact weights are kept. */
  setAnchors(anchors: Record<Foot, FootAnchor>) {
    for (const side of sides)
      this.contacts[side].anchor = { position: { ...anchors[side].position }, yaw: anchors[side].yaw }
  }

  step(input: FootContactInput, dt: number) {
    for (const side of sides) {
      const state = this.contacts[side]
      const foot = input.feet[side]
      const desired = Number(input.enabled) * (1 - foot.clipFootTrackWeight) * input.duck
      if (desired > 0 && state.desired === 0 && state.c === 0) {
        state.anchor = {
          position: { ...foot.position, y: this.options.traits.footBaselineY },
          yaw: foot.yaw,
        }
      }
      if (desired !== state.desired) {
        state.start = state.c
        state.elapsed = 0
        state.desired = desired
      }
      state.elapsed = Math.min(0.3, state.elapsed + dt)
      const t = state.elapsed / 0.3
      state.c = blend(state.start, desired, t * t * (3 - 2 * t))
    }

    const maxDrop = 0.06 * Math.min(this.lengths.left, this.lengths.right)
    const offset = input.pelvisOffset
    let lateralScale = 1
    // Intersect both legs' reachable horizontal disks at the maximum permitted drop.
    // Clamping only rho to rMax would still exceed reach when drop hits its cap.
    for (const side of sides) {
      if (this.contacts[side].c === 0 || this.lengths[side] === 0)
        continue
      const hip = this.options.legs[side].hip
      const ground = this.contacts[side].anchor.position
      const rMax = 0.985 * this.lengths[side]
      const vertical = hip.y + offset.y - maxDrop - ground.y
      const dx = hip.x - ground.x
      const dz = hip.z - ground.z
      const a = offset.x ** 2 + offset.z ** 2
      const b = dx * offset.x + dz * offset.z
      const c = dx ** 2 + dz ** 2 + vertical ** 2 - rMax ** 2
      if (a > 0) {
        const upper = (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a
        lateralScale = Math.min(lateralScale, Math.max(0, upper))
      }
    }
    const x = offset.x * lateralScale
    const z = offset.z * lateralScale
    let required = 0
    for (const side of sides) {
      if (this.contacts[side].c === 0 || this.lengths[side] === 0)
        continue
      const hip = this.options.legs[side].hip
      const ground = this.contacts[side].anchor.position
      const rhoSquared = (hip.x + x - ground.x) ** 2 + (hip.z + z - ground.z) ** 2
      const rMax = 0.985 * this.lengths[side]
      required = Math.max(required, hip.y + offset.y - ground.y - Math.sqrt(Math.max(0, rMax ** 2 - rhoSquared)))
    }
    // Never smooth below the geometrically required drop; only recovery is eased.
    this.drop = Math.min(maxDrop, Math.max(required, this.drop * Math.exp(-dt / 0.3)))
    const output = (side: Foot) => {
      const state = this.contacts[side]
      return {
        anchor: { position: { ...state.anchor.position }, yaw: state.anchor.yaw },
        target: blendAnchor(input.feet[side], state.anchor, state.c),
        c: state.c,
        // three-mmd dist/index.js:2782 skips collinear CCD axes before knee limits.
        kneePreBend: input.feet[side].kneeAnimated ? 0 : this.options.traits.kneeBendSign * 4 * Math.PI / 180,
      }
    }
    return {
      pelvisOffset: { x, y: offset.y - this.drop, z },
      drop: this.drop,
      lateralScale,
      feet: { left: output('left'), right: output('right') },
    }
  }
}

/**
 * Bind hips must be reachable from the planted ankles within a 6% leg-length drop.
 * Offsets are sway translations, not arbitrary vertical teleports. Weights are [0, 1].
 */
export function createFootContact(options: ConstructorParameters<typeof FootContact>[0]) {
  return new FootContact(options)
}

export interface TurnStep {
  readonly foot: Foot
  /** Relative yaw about the supplied mesh-local pivot, in radians. */
  readonly yawDelta: number
  readonly duration: number
}

/**
 * Plan newly issued turn commands once, then sample each sequential arc in seconds.
 * Each arc lifts `swingHeight` model units at its midpoint; gait callers pass 0.03 * legLength.
 */
export function planFootSteps(turnSteps: readonly TurnStep[], anchors: Record<Foot, FootAnchor>, pivot: Vec3, swingHeight = 0.3) {
  const current = { ...anchors }
  return turnSteps.map((step) => {
    const start = current[step.foot]
    const dx = start.position.x - pivot.x
    const dz = start.position.z - pivot.z
    const cos = Math.cos(step.yawDelta)
    const sin = Math.sin(step.yawDelta)
    const end: FootAnchor = {
      position: { x: pivot.x + cos * dx + sin * dz, y: start.position.y, z: pivot.z - sin * dx + cos * dz },
      yaw: start.yaw + step.yawDelta,
    }
    current[step.foot] = end
    return {
      foot: step.foot,
      duration: step.duration,
      sample(elapsed: number): FootAnchor {
        const t = step.duration > 0 ? Math.max(0, Math.min(1, elapsed / step.duration)) : 1
        const target = blendAnchor(start, end, t)
        return {
          position: { ...target.position, y: target.position.y + (t > 0 && t < 1 ? swingHeight * Math.sin(Math.PI * t) : 0) },
          yaw: target.yaw,
        }
      },
    }
  })
}
