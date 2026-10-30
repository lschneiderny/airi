import type { BusyState, SituationState } from './types'

import { isDenylisted } from './window-title'

/**
 * Starting salience from which a notify is urgent: it bypasses the timing
 * holds and the game suppressor, never the other hard suppressors. Matches
 * `notify-immediate` and `notify-critical` in `BASE_SALIENCE`.
 */
export const URGENT_SALIENCE = 1

/**
 * Live inputs the gate cannot read from the situation. Every flag fails
 * closed: anything other than the explicit "clear" value suppresses.
 */
export interface GateSignals {
  /** Whether the user is talking into voice capture; `null` (cannot tell) counts as speaking. */
  readonly userSpeaking: boolean | null
  /** Non-empty chat draft, or composer input within the last 10 s, in any window. */
  readonly userTyping: boolean
  readonly characterSpeaking: boolean
  /** A chat turn is generating (raw `sending`, unprompted turns included). */
  readonly generating: boolean
  /** Sends waiting in the chat queue. Anything but `0` suppresses. */
  readonly queued: number
  /** The desktop-activity sample is recent enough to trust. */
  readonly desktopFresh: boolean
  /** The foreground-window sample is recent enough to trust. */
  readonly foregroundFresh: boolean
  /** The stage window is shown and not minimized. Hosts that never report it count as hidden. */
  readonly stageVisible: boolean
}

export interface GateSettings {
  readonly enabled: boolean
  /** 0..1. Out-of-range values are clamped; a non-finite value counts as 0 (least chatty). */
  readonly chattiness: number
  readonly dontDisturb: boolean
  /** App id globs (`*` wildcard, case-insensitive) during which the character stays quiet. */
  readonly quietApps: readonly string[]
  /** When false, a game in the foreground suppresses everything but urgent notifies. */
  readonly speakDuringGames: boolean
}

export type GateOutcome = 'spoken' | 'declined' | 'cancelled' | 'failed'

/** Hard suppressors, in the order they are checked. */
export type GateHardReason
  = | 'invalid-time'
    | 'disabled'
    | 'dont-disturb'
    | 'stage-hidden'
    | 'presence-away'
    | 'presence-unknown'
    | 'stale-signal'
    | 'user-speaking'
    | 'user-typing'
    | 'character-speaking'
    | 'generating'
    | 'queued'
    | `busy-${Exclude<BusyState, 'accepts'>}`
    | 'quiet-app'
    | 'busy-game'

/** What the hard suppressors read. The urge gate input carries all of it. */
export interface GateHardInput {
  readonly situation: SituationState
  readonly signals: GateSignals
  readonly settings: GateSettings
}

const BUSY_HOLD_STATES: ReadonlySet<string> = new Set<BusyState>(['busy', 'fullscreen', 'presentation', 'quiet', 'unknown'])

/**
 * The first hard suppressor that holds, in the order of {@link GateHardReason},
 * or `null` when none does. Every signal fails closed. `urgent` is whether an
 * urgent notify is on offer: it lets `busy-game` through and nothing else.
 */
export function hardReason(input: GateHardInput, urgent: boolean): GateHardReason | null {
  const { signals, settings, situation } = input
  if (settings.enabled !== true)
    return 'disabled'
  if (settings.dontDisturb !== false)
    return 'dont-disturb'
  if (signals.stageVisible !== true)
    return 'stage-hidden'
  const presence = situation.presence.state
  if (presence === 'away')
    return 'presence-away'
  if (presence !== 'here' && presence !== 'idle')
    return 'presence-unknown'
  if (signals.desktopFresh !== true || signals.foregroundFresh !== true)
    return 'stale-signal'
  if (signals.userSpeaking !== false)
    return 'user-speaking'
  if (signals.userTyping !== false)
    return 'user-typing'
  if (signals.characterSpeaking !== false)
    return 'character-speaking'
  if (signals.generating !== false)
    return 'generating'
  if (signals.queued !== 0)
    return 'queued'
  const busy = situation.busy.state
  if (busy !== 'accepts')
    return BUSY_HOLD_STATES.has(busy) ? `busy-${busy}` : 'busy-unknown'

  const activity = situation.activity
  if (activity !== null) {
    const quietApps = Array.isArray(settings.quietApps) ? settings.quietApps.filter((glob): glob is string => typeof glob === 'string') : []
    if (activity.category === 'call' || (activity.appId !== '' && isDenylisted(activity.appId, quietApps)))
      return 'quiet-app'
    if (activity.category === 'game' && settings.speakDuringGames !== true && !urgent)
      return 'busy-game'
  }
  return null
}
