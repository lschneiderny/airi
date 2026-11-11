import { BODY_TICK } from '@proj-airi/motion-driver-humanoid/performance'

/**
 * The body's one 120 Hz clock. The gait and the performer advance in whole ticks only, so a seed gives the same motion at
 * 30, 60 or 144 frames per second; the display shows the two latest ticks blended by the leftover `fraction`.
 */
export class MMDBodyClock {
  private remainder = 0
  private count = 0

  /** Ticks completed since creation or `reset`; the performer's and the gait's time is `ticks * BODY_TICK`. */
  get ticks(): number {
    return this.count
  }

  get time(): number {
    return this.count * BODY_TICK
  }

  /** Share of a tick elapsed after the latest one, in [0, 1]. */
  get fraction(): number {
    return Math.min(1, Math.max(0, this.remainder / BODY_TICK))
  }

  /** Adds display seconds and returns how many ticks fall due. A 1/60 s frame is exactly two ticks despite rounding. */
  advance(dt: number): number {
    this.remainder += dt
    let due = 0
    while (this.remainder >= BODY_TICK - 1e-9) {
      this.remainder -= BODY_TICK
      due++
    }
    this.count += due
    return due
  }

  reset(): void {
    this.remainder = 0
    this.count = 0
  }
}
