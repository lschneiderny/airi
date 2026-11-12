import type { SelfActivity, SituationSelfPast, SituationState } from './types'

import { SELF_LONG_LIVED } from './types'

const MINUTE_MS = 60_000

/** A finished activity is worth telling for this long; a sleep or a sit stays worth telling for longer. */
const SELF_RECENT_MS = 10 * MINUTE_MS
const SELF_RECENT_LONG_MS = 30 * MINUTE_MS
/** An activity that is not long-lived cannot be in progress for longer than this; its end report was lost. */
const SELF_CURRENT_MAX_MS = 2 * MINUTE_MS
/** A sleep or a sit shorter than this is told without its length. */
const SELF_DURATION_MIN_MS = MINUTE_MS

/** What she is doing, to follow "You are". */
const ONGOING: Record<SelfActivity, (user: string, label: string | null) => string> = {
  'stretch': () => 'stretching',
  'yawn': () => 'yawning',
  'look-around': () => 'looking around',
  'check-in': user => `looking over at ${user}`,
  'peer': () => 'leaning in to watch the screen',
  'zone-out': () => 'zoning out',
  'nod-off': () => 'nodding off',
  'sway': () => 'swaying along to the music',
  'sleep': () => 'dozing',
  'held-back': () => 'holding back something you almost said',
  'sit': () => 'sitting down',
  'wander': () => 'wandering across the desktop',
  'visit': user => `walking over to see what ${user} is doing`,
  'go-home': () => 'walking back to your spot',
  'clip': (_user, label) => label === null ? 'doing a little move of your own' : `doing your "${label}" move`,
}

/** What she did, to follow "You". */
const PAST: Record<SelfActivity, (user: string, label: string | null) => string> = {
  'stretch': () => 'stretched',
  'yawn': () => 'yawned',
  'look-around': () => 'looked around',
  'check-in': user => `glanced over at ${user}`,
  'peer': () => 'leaned in to watch the screen',
  'zone-out': () => 'zoned out for a bit',
  'nod-off': () => 'nodded off for a moment',
  'sway': () => 'swayed along to the music',
  'sleep': () => 'dozed off',
  'held-back': () => 'almost said something and let it go',
  'sit': () => 'sat down',
  'wander': () => 'wandered across the desktop',
  'visit': user => `walked over to see what ${user} was doing`,
  'go-home': () => 'walked back to your spot',
  'clip': (_user, label) => label === null ? 'did a little move of your own' : `did your "${label}" move`,
}

function minutesText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS))
  if (minutes < 60)
    return `about ${minutes} min`
  const hours = Math.round(minutes / 30) / 2
  return `about ${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`
}

function agoText(ms: number): string {
  return ms < MINUTE_MS ? 'just now' : `${minutesText(ms).replace('about ', '')} ago`
}

/** The activity in progress, unless it is one that cannot last and its end never arrived (a stage that went away). */
function liveCurrent(state: SituationState, nowMs: number) {
  const { current } = state.self
  if (current === null || (!SELF_LONG_LIVED.has(current.activity) && nowMs - current.sinceMs > SELF_CURRENT_MAX_MS))
    return null
  return current
}

function pastText(past: SituationSelfPast, nowMs: number, userName: string): string {
  const length = SELF_LONG_LIVED.has(past.activity) && past.durationMs >= SELF_DURATION_MIN_MS ? ` for ${minutesText(past.durationMs)}` : ''
  return `${PAST[past.activity](userName, past.label)}${length} ${agoText(nowMs - past.endedAtMs)}`
}

/** Finished activities still worth telling at `nowMs`, newest first, each activity once. */
function freshPast(state: SituationState, nowMs: number): SituationSelfPast[] {
  const seen = new Set<SelfActivity>()
  return state.self.recent.filter((past) => {
    const age = nowMs - past.endedAtMs
    const fresh = age >= 0 && age <= (SELF_LONG_LIVED.has(past.activity) ? SELF_RECENT_LONG_MS : SELF_RECENT_MS)
    if (!fresh || seen.has(past.activity))
      return false
    seen.add(past.activity)
    return true
  })
}

/**
 * One sentence about what the character is doing or just did on her own, addressed to her, or `null` when there is
 * nothing recent. The activity in progress comes first, then the newest finished one, which happened before it or,
 * inside a sleep or a sit, during it; without one in progress, up to two finished ones are named. `userName` replaces "the user" in the activities that involve them.
 */
export function selfLine(state: SituationState, nowMs: number, userName: string): string | null {
  if (!Number.isFinite(nowMs))
    return null
  const current = liveCurrent(state, nowMs)
  const past = freshPast(state, nowMs)
  if (current !== null) {
    const elapsed = nowMs - current.sinceMs
    const ongoing = `You are ${ONGOING[current.activity](userName, current.label)}${SELF_LONG_LIVED.has(current.activity) && elapsed >= SELF_DURATION_MIN_MS ? `, for ${minutesText(elapsed)} now` : ''}`
    if (past.length === 0)
      return `${ongoing}.`
    // A short activity inside a sleep or a sit happened during it, not before it.
    const joiner = past[0].endedAtMs >= current.sinceMs ? ', and you ' : '; before that you '
    return `${ongoing}${joiner}${pastText(past[0], nowMs, userName)}.`
  }
  if (past.length === 0)
    return null
  const [first, second] = past
  return second ? `You ${pastText(first, nowMs, userName)}, and ${pastText(second, nowMs, userName)}.` : `You ${pastText(first, nowMs, userName)}.`
}

/**
 * A short clause that anchors a thought of her own to what she was visibly doing, such as `you are zoning out` or
 * `you just yawned`, or `null` when nothing recent exists. It names no time, so it reads naturally inside a reason.
 */
export function selfHint(state: SituationState, nowMs: number): string | null {
  if (!Number.isFinite(nowMs))
    return null
  const current = liveCurrent(state, nowMs)
  if (current !== null)
    return `you are ${ONGOING[current.activity]('them', current.label)}`
  const [first] = freshPast(state, nowMs)
  return first ? `you just ${PAST[first.activity]('them', first.label)}` : null
}
