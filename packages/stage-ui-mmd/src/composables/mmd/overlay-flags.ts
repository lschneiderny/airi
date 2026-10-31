// Kept free of `three` so the diagnostics store, which every stage loads, does not pull the 3D runtime.

/** Which devtools overlays the stage draws. The lab sets them over the diagnostics channel. */
export interface MMDOverlayFlags {
  /** Every PMX IK chain, through the solver's own helper. */
  ik: boolean
  /** Touch colliders as wireframes: head bodies in one color, body bodies in another. */
  colliders: boolean
  /** Foot anchors: the leg IK bones the foot-contact stage writes, and the ankles they pull. */
  feet: boolean
  /** The world-space point the body look-at is turning toward. */
  lookAt: boolean
  /** Stage mode: the floor line, `y = 0` across the work area at `z = 0`. */
  floorLine: boolean
  /** Stage mode: the reachable ground segment, `ground.minX` to `ground.maxX` on the floor line. */
  groundLine: boolean
  /** Stage mode: a marker at `homeX`. */
  home: boolean
  /** Stage mode: a marker at the director's `goalX` with the locomotion reason as its label. */
  goal: boolean
  /** The capsules the arm penetration test sweeps: the lower upper arm and the forearm through the hand, per side. */
  armCapsules: boolean
}

export const mmdOverlayFlagNames = ['ik', 'colliders', 'feet', 'lookAt', 'floorLine', 'groundLine', 'home', 'goal', 'armCapsules'] as const satisfies readonly (keyof MMDOverlayFlags)[]

export const mmdOverlaysOff: MMDOverlayFlags = { ik: false, colliders: false, feet: false, lookAt: false, floorLine: false, groundLine: false, home: false, goal: false, armCapsules: false }

export function isMMDOverlayFlags(value: unknown): value is Partial<MMDOverlayFlags> {
  if (typeof value !== 'object' || value === null)
    return false
  return Object.entries(value).every(([key, on]) => (mmdOverlayFlagNames as readonly string[]).includes(key) && typeof on === 'boolean')
}

/** Overlay colors, shared with the lab legend so the readout matches the stage. */
export const mmdOverlayColors = {
  colliderHead: 0xF472B6,
  colliderBody: 0x38BDF8,
  footAnchor: 0xFACC15,
  ankle: 0xFB923C,
  lookAt: 0x4ADE80,
  floorLine: 0x94A3B8,
  groundLine: 0x22D3EE,
  home: 0xA78BFA,
  goal: 0xF87171,
  armCapsule: 0xFBBF24,
} as const
