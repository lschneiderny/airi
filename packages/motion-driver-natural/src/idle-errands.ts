/**
 * Long behaviours the host realises in full, which Natural's idle draw only decides: a pastime with one of her own
 * props (Live2D), an unasked clip (MMD), and a wander along the ground (MMD, roam mode). Natural draws each in its
 * single idle draw, records it, and leaves its form to the host's realiser, which answers whether it took it.
 */
export const IDLE_ERRAND_KINDS = ['pastime', 'idle-clip', 'wander'] as const
export type IdleErrandKind = typeof IDLE_ERRAND_KINDS[number]

/**
 * How each errand is paced, taken from the timer it replaces (idle agency ADR, amendment of 2026-11-14). The draw
 * starts one at `1 / meanGap` per second of eligible time once `refractory` seconds have passed since the last one's
 * `from` moment, and, with `firstAfterListing`, since the host first listed it.
 *
 * - `pastime`: `decideIdleProp` drew a pastime at a mean of 360 s of free time after a rest of 120 s that followed each
 *   pastime's end and the stage's opening.
 * - `idle-clip`: `decideIdleClip` drew a clip at a mean of 240 s of quiet time, at least 60 s after the last one started;
 *   its first clip had no rest.
 * - `wander`: the director drew the next wander 600 to 1200 s after one started, and the first after roaming began,
 *   log-uniformly, so at least 600 s and `600 / ln 2` = 865.6 s on average. A hazard of `1 / 265.6` after the 600 s
 *   keeps both the minimum and the mean.
 */
export const IDLE_ERRAND_PACING: Readonly<Record<IdleErrandKind, { readonly meanGap: number, readonly refractory: number, readonly from: 'start' | 'end', readonly firstAfterListing: boolean }>> = Object.freeze({
  'pastime': { meanGap: 360, refractory: 120, from: 'end', firstAfterListing: true },
  'idle-clip': { meanGap: 240, refractory: 60, from: 'start', firstAfterListing: false },
  'wander': { meanGap: 600 / Math.LN2 - 600, refractory: 600, from: 'start', firstAfterListing: true },
})

/** Seconds she keeps a pastime: the bounds of `decideIdleProp`'s uniform hold. */
export const PASTIME_HOLD_SECONDS = Object.freeze({ min: 90, max: 300 })

/**
 * How an errand ended: it ran its course or its realiser finished it (`done`), its realiser could not take it
 * (`refused`), or Natural ended it because she stopped being free for it (`interrupted`).
 */
export type IdleErrandOutcome = 'done' | 'refused' | 'interrupted'

/** The latest errand the draw started, kept after it ends. Times are Natural's active seconds. */
export interface IdleErrandRecord {
  readonly seq: number
  readonly kind: IdleErrandKind
  readonly start: number
  /** A pastime's drawn end; `Infinity` for an errand that lasts until its realiser answers. */
  readonly end: number
  /** A uniform draw in [0, 1) for the realiser's choice among what it can play (which prop, which clip). */
  readonly pick: number
  readonly endedAt: number | null
  readonly outcome: IdleErrandOutcome | null
}

/** An errand started, or the one that ran ended. */
export interface IdleErrandReport {
  phase: 'start' | 'end'
  errand: IdleErrandRecord
}

/**
 * Turns successive reads of the latest errand record into start and end reports, each errand reported once. A reader
 * that samples once per frame uses it to follow errands without an observer.
 */
export class IdleErrandReports {
  private seq = 0
  private ended = true
  private latest: IdleErrandRecord | null = null

  read(record: IdleErrandRecord | null): IdleErrandReport[] {
    const reports: IdleErrandReport[] = []
    if (record === null)
      return reports
    this.latest = record
    if (record.seq !== this.seq) {
      this.seq = record.seq
      this.ended = false
      reports.push({ phase: 'start', errand: record })
    }
    if (!this.ended && record.endedAt !== null) {
      this.ended = true
      reports.push({ phase: 'end', errand: record })
    }
    return reports
  }

  /**
   * Ends the errand in progress at `at` (`interrupted`) for whoever follows the reports, when the controller stops
   * driving the model or goes away; the controller's own record is left as it is.
   */
  close(at: number): IdleErrandReport[] {
    if (this.ended || this.latest === null)
      return []
    this.ended = true
    return [{ phase: 'end', errand: { ...this.latest, endedAt: at, outcome: 'interrupted' } }]
  }
}
