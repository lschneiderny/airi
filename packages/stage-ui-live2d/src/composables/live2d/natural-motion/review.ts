import type { NaturalReviewGains, NaturalReviewState } from '@proj-airi/motion-driver-natural/review'

import { neutralReviewGains } from '@proj-airi/motion-driver-natural/review'

/** What the Natural lab asks of the stage while someone reviews idle motion. Not persisted. */
export interface NaturalReviewSettings {
  gains: NaturalReviewGains
  /** Self-directed idle behaviour (acts, sleep, pastimes). Off withholds the idle drive, like the Idle activities setting. */
  acts: boolean
  /** Draw the caption that names what drives the head and the eyes. */
  caption: boolean
}

export const neutralReviewSettings: Readonly<NaturalReviewSettings> = Object.freeze({ gains: neutralReviewGains, acts: true, caption: false })

/** Which settings the stage ran when a moment was flagged: the shipped motion, or the reviewer's tuned gains. */
export type NaturalReviewVariant = 'current' | 'tuned'

/** One change of what drives her, at `at` active seconds of the controller clock. */
export interface NaturalReviewEntry {
  at: number
  text: string
}

/** A moment the reviewer marked as looking wrong, with what led up to it. */
export interface NaturalReviewFlag {
  id: string
  /** Wall-clock time of the flag, ISO 8601. */
  flaggedAt: string
  modelId: string | null
  variant: NaturalReviewVariant
  settings: NaturalReviewSettings
  state: NaturalReviewState
  /** The caption at the flag, one string per line. */
  caption: string[]
  /** The changes of the 10 s before the flag, oldest first. */
  recent: NaturalReviewEntry[]
}

/** One caption line. The text is a developer readout built from controller identifiers; it is not translated. */
export interface NaturalReviewCaptionLine {
  label: 'head' | 'eyes' | 'act' | 'mode'
  text: string
}

/** Live2D head angles span 30 degrees per normalized head unit. */
const degreesPerHeadUnit = 30
const recentSeconds = 10
/** Bounds the log while a cursor pursuit starts catch-up saccades many times a second. */
const maxEntries = 120

/** A shift muted by its review gain moves nothing, so it is neither captioned nor logged. */
function shows(head: NaturalReviewState['head']) {
  return head.size * degreesPerHeadUnit >= 0.05
}

function shiftText(head: NaturalReviewState['head']) {
  return `shift ${(head.size * degreesPerHeadUnit).toFixed(1)} deg ${head.withGlance ? 'with a glance' : 'alone'}`
}

/**
 * Follows the review state frame by frame and keeps what changed in the last 10 s, so a flag can say what led up
 * to the moment the reviewer disliked. Sample it once per composed frame.
 */
export class NaturalReviewLog {
  private entries: NaturalReviewEntry[] = []
  private previous: NaturalReviewState | null = null
  /** Active seconds at which the head came to rest, or `null` while it moves. */
  private heldSince: number | null = null

  sample(state: NaturalReviewState) {
    const previous = this.previous
    this.previous = state
    const add = (text: string) => this.entries.push({ at: state.time, text })
    if (previous === null || state.time < previous.time) {
      // A new controller restarts the clock, so earlier entries no longer line up.
      this.entries = []
      this.heldSince = state.head.moving && shows(state.head) ? null : state.time
      return
    }
    if (state.mode !== previous.mode)
      add(`mode ${state.mode}`)
    if (state.owner !== previous.owner)
      add(state.owner === null ? `${previous.owner} released` : `${state.owner} took over`)
    if (state.act !== previous.act) {
      if (previous.act !== null)
        add(`act ${previous.act} ended`)
      if (state.act !== null)
        add(`act ${state.act} started`)
    }
    if (state.errand !== previous.errand)
      add(state.errand === null ? `errand ${previous.errand} ended` : `errand ${state.errand} started`)
    if (state.head.seq !== previous.head.seq && shows(state.head))
      add(`head ${shiftText(state.head)}`)
    if (state.eyes.seq !== previous.eyes.seq)
      add(`eyes to ${state.eyes.target}`)
    if (state.head.moving && shows(state.head))
      this.heldSince = null
    else
      this.heldSince ??= state.time
    while (this.entries.length > maxEntries || (this.entries.length > 0 && state.time - this.entries[0].at > recentSeconds))
      this.entries.shift()
  }

  /** The changes of the last 10 s, oldest first. */
  recent(): NaturalReviewEntry[] {
    return this.entries.map(entry => ({ ...entry }))
  }

  /** The caption for the latest sample, or no lines before the first. */
  caption(): NaturalReviewCaptionLine[] {
    const state = this.previous
    if (state === null)
      return []
    const held = this.heldSince === null ? 0 : state.time - this.heldSince
    return [
      { label: 'head', text: state.head.moving && shows(state.head) ? shiftText(state.head) : `holding ${held.toFixed(1)} s` },
      { label: 'eyes', text: state.eyes.target },
      { label: 'act', text: [state.act, state.errand].filter(part => part !== null).join(' + ') || '-' },
      { label: 'mode', text: state.owner === null ? state.mode : `${state.mode}, ${state.owner}` },
    ]
  }
}
