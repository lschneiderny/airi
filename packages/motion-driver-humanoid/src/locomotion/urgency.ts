import { WALK_URGENCY } from '../types'

/**
 * (urgency, share of the reference speed) anchors. The former paces map exactly: stroll (0.3) walks at 0.6 and walk
 * (0.6) at 1. An amble at 0 is 0.4, and a hurry at 1 is 1.35, the top of the acted styles' speed range (active walks
 * at 1.22 of a normal walk, plan `walk-style` section 1).
 */
const speedAnchors: readonly (readonly [number, number])[] = [[0, 0.4], [0.3, 0.6], [0.6, 1], [1, 1.35]]

/** `urgency` in [0, 1]; NaN reads as `WALK_URGENCY`, and values outside the range are clamped. */
export function clampUrgency(urgency: number): number {
  return Number.isNaN(urgency) ? WALK_URGENCY : Math.min(1, Math.max(0, urgency))
}

/**
 * The share of the reference speed an urgency asks for, linear between the anchors. An anchor starts its segment, so
 * an urgency on an anchor returns the anchor's share bit for bit (t = 0).
 */
export function urgencySpeedShare(urgency: number): number {
  const u = clampUrgency(urgency)
  let i = 0
  while (i < speedAnchors.length - 2 && u >= speedAnchors[i + 1][0])
    i++
  const [u0, a] = speedAnchors[i]
  const [u1, b] = speedAnchors[i + 1]
  return a + (b - a) * ((u - u0) / (u1 - u0))
}
