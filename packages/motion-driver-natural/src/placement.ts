/**
 * Shapes screen inwardness: positive means inward toward screen +x, positive gaze x,
 * and positive head X (ParamAngleX). The central dead zone returns positive zero.
 */
export function shapeInwardness(u: number): number {
  if (!(Math.abs(u) > 0.15))
    return 0
  const t = Math.min(1, (Math.abs(u) - 0.15) / (0.80 - 0.15))
  return Math.sign(u) * t * t * (3 - 2 * t)
}

/** Placement eases on active seconds; disabling immediately restores the no-signal path. */
export class NaturalPlacement {
  target = 0
  enabled = false
  private current = 0

  get value(): number {
    return this.current
  }

  set(u: number | null) {
    this.enabled = u !== null
    this.target = u === null ? 0 : shapeInwardness(u)
    if (u === null)
      this.current = 0
  }

  step(dt: number) {
    this.current = this.target + (this.current - this.target) * Math.exp(-dt / 2.0)
  }
}
