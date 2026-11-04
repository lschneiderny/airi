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
}

export const mmdOverlayFlagNames = ['ik', 'colliders', 'feet', 'lookAt'] as const satisfies readonly (keyof MMDOverlayFlags)[]

export const mmdOverlaysOff: MMDOverlayFlags = { ik: false, colliders: false, feet: false, lookAt: false }

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
} as const
