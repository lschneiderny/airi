import type { RandomStream } from './random'

import { gaussian } from './random'

// Gaze shifts above this normalized eye-space distance can pull a pending blink forward.
export const largeGazeShift = 0.15
// Only a blink already due within this many seconds moves onto a large gaze shift,
// so most shifts keep the eyes open.
const advanceWindow = 0.8
const doubleBlinkProbability = 0.08

type Phase = 'open' | 'closing' | 'opening'

/**
 * Natural blink timing as a single scheduler.
 *
 * After each reopening the eyes stay open for `0.6 + lognormal(median 4, logSD 0.5)` s.
 * Closing takes 60-90 ms (ease-out) and opening 160-260 ms (ease-in). 8% of blinks
 * are followed by a second blink 120-220 ms after reopening. A blink already due
 * within 0.8 s starts early when `onGazeShift` reports a shift above 0.15 normalized.
 *
 * Time is seconds of active motion; callers step on a fixed grid.
 */
export class NaturalBlinkScheduler {
  /**
   * Mirrors the user auto-blink setting. While false, `blinkFactor` stays 1 and
   * the schedule keeps running, so enabling never starts from a reset state.
   * @default true
   */
  enabled = true

  /** Scales newly drawn open intervals, not lid timing or double-blink gaps. @default 1 */
  intervalScale = 1

  private time = 0
  private phase: Phase = 'open'
  private phaseStart = 0
  private closeDuration = 0
  private openDuration = 0
  // True from the start of the first blink of a double until the second blink starts.
  private secondBlinkPending = false
  private nextBlinkAt: number
  private factor = 1

  constructor(private readonly random: RandomStream) {
    this.nextBlinkAt = this.drawInterval()
  }

  /** Lid closure multiplier in [0, 1]: 1 open, 0 fully closed. */
  get blinkFactor() {
    return this.enabled ? this.factor : 1
  }

  /** Reports a gaze shift of `size` normalized eye-space units at the current time. */
  onGazeShift(size: number) {
    if (this.phase !== 'open' || this.secondBlinkPending || size <= largeGazeShift)
      return
    if (this.nextBlinkAt - this.time <= advanceWindow)
      this.nextBlinkAt = this.time
  }

  /** Advances by `dt` seconds and returns `blinkFactor`. */
  step(dt: number) {
    this.time += dt
    if (this.phase === 'open' && this.time >= this.nextBlinkAt)
      this.begin(this.nextBlinkAt)
    if (this.phase === 'closing' && this.time >= this.phaseStart + this.closeDuration) {
      this.phase = 'opening'
      this.phaseStart += this.closeDuration
    }
    if (this.phase === 'opening' && this.time >= this.phaseStart + this.openDuration) {
      const reopenedAt = this.phaseStart + this.openDuration
      this.phase = 'open'
      this.nextBlinkAt = reopenedAt + (this.secondBlinkPending ? 0.12 + 0.10 * this.random() : this.drawInterval())
    }
    this.factor = this.factorAt(this.time)
    return this.blinkFactor
  }

  private begin(at: number) {
    // The second blink of a double never chains into a third.
    this.secondBlinkPending = !this.secondBlinkPending && this.random() < doubleBlinkProbability
    this.phase = 'closing'
    this.phaseStart = at
    this.closeDuration = 0.06 + 0.03 * this.random()
    this.openDuration = 0.16 + 0.10 * this.random()
  }

  private factorAt(time: number) {
    const elapsed = time - this.phaseStart
    if (this.phase === 'closing') {
      // Ease-out: the lid drops fast, then settles closed.
      const u = Math.min(1, elapsed / this.closeDuration)
      return (1 - u) * (1 - u)
    }
    if (this.phase === 'opening') {
      // Ease-in: the lid lifts slowly, then accelerates open.
      const u = Math.min(1, elapsed / this.openDuration)
      return u * u
    }
    return 1
  }

  private drawInterval() {
    return (0.6 + 4 * Math.exp(0.5 * gaussian(this.random))) * this.intervalScale
  }
}
