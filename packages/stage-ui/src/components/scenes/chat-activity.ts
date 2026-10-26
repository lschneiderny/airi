/** The latest `chatComposerActivityChangedEvent` of one composer: timing only, never draft text. */
export interface ChatComposerReport {
  hasDraft: boolean
  /** Epoch milliseconds of the composer's last draft change. */
  lastInputAtMs: number
}

/** Chat activity the stage hands to Natural: typing timing and typed-send counters, never text. */
export interface ChatActivity {
  typing: boolean
  /** Increments once per typed send the stage heard. */
  sentSeq: number
  /** Word count of the last typed send. */
  sentWords: number
}

/** A draft change counts as typing for this long after it happened. */
export const chatTypingWindowMs = 1500

/**
 * Combines the composer reports of every chat window into the activity Natural reads.
 *
 * Expects:
 * - `reports` holds the latest report per composer source
 * - `nowMs` and each `lastInputAtMs` are epoch milliseconds from the same machine
 *
 * Returns:
 * - `typing` true while any composer holds a draft whose last change is at most {@link chatTypingWindowMs} old
 */
export function chatActivityFrom(reports: Iterable<ChatComposerReport>, nowMs: number, sent: { sentSeq: number, sentWords: number }): ChatActivity {
  let typing = false
  for (const report of reports) {
    if (report.hasDraft && nowMs - report.lastInputAtMs <= chatTypingWindowMs) {
      typing = true
      break
    }
  }
  return { typing, sentSeq: sent.sentSeq, sentWords: sent.sentWords }
}
