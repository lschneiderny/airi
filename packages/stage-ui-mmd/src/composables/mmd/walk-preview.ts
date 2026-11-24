import type { GaitBaseline } from '@proj-airi/motion-driver-humanoid/locomotion'

/** How long a card editor's walk preview holds its baseline once she sets off, on the director clock. */
export const WALK_PREVIEW_MS = 12_000
/** How long a preview waits for the director to take up its goal; renewed while the director holds the goal. */
export const WALK_PREVIEW_WAIT_MS = 30_000

/**
 * A card editor's walk preview on the stage. It waits while the director holds the preview's debug goal, as speech and
 * full-body clips do, then holds its baseline for `WALK_PREVIEW_MS` from the frame she walks to that goal. A preview whose
 * goal the director never takes up runs out after `WALK_PREVIEW_WAIT_MS`.
 */
export class MMDWalkPreview {
  private baseline: GaitBaseline | undefined
  private arrived = false
  private waiting = false
  private untilMs = Number.NEGATIVE_INFINITY

  /** A new preview; the next frame starts its wait. */
  start(baseline: GaitBaseline) {
    this.baseline = baseline
    this.arrived = true
  }

  /** The baseline she walks with this frame: the preview's while it runs, otherwise the card's. */
  update(nowMs: number, debugGoal: 'held' | 'issued' | null, traveling: boolean, card: GaitBaseline | undefined): GaitBaseline | undefined {
    if (this.arrived) {
      this.arrived = false
      this.waiting = true
      this.untilMs = nowMs + WALK_PREVIEW_WAIT_MS
    }
    if (this.waiting) {
      if (debugGoal === 'held')
        this.untilMs = nowMs + WALK_PREVIEW_WAIT_MS
      if (nowMs >= this.untilMs) {
        this.waiting = false
      }
      else if (debugGoal === 'issued' && traveling) {
        this.waiting = false
        this.untilMs = nowMs + WALK_PREVIEW_MS
      }
    }
    return nowMs < this.untilMs ? this.baseline : card
  }
}
