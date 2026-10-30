import type { WebSocketEventOf } from '@proj-airi/server-sdk'
import type { NotifyObservation, NotifyUrgency } from '@proj-airi/stage-shared/situation'

import { getSpeechBusContext, situationNotifyObservedEvent } from '../../../services/speech/bus'
import { getEventSourceKey } from '../../../utils/event-source'
import { useSituationStore } from '../index'
import { situationContextText } from './context-text'

/** Longest notify note, in code points, that the situation keeps. */
export const NOTIFY_NOTE_MAX_CHARS = 200

/** The source key of reminders that the character's own task scheduler raises. */
export const TASK_SCHEDULER_SOURCE = 'character:task-scheduler'

/**
 * Maps one `spark:notify` event to a situation `notify` observation. This is the only producer of notify
 * observations, so every notify topic key comes from `getEventSourceKey(event)` and the protocol `eventId`, which
 * stays the same when the scheduler re-sends a reminder.
 *
 * Plugin text is untrusted: the headline and note go through {@link situationContextText}, and the note is capped at
 * {@link NOTIFY_NOTE_MAX_CHARS}. A missing or non-string headline or event id becomes an empty string, which the
 * reducer drops, so a malformed payload never throws; an unknown urgency counts as `later`. `critical` is set only
 * for scheduler reminders whose `payload.priority` is `critical`.
 */
export function notifyObservationFrom(event: WebSocketEventOf<'spark:notify'>, nowMs: number): NotifyObservation {
  const data: Partial<WebSocketEventOf<'spark:notify'>['data']> = event.data ?? {}
  const note = typeof data.note === 'string' ? Array.from(situationContextText(data.note)).slice(0, NOTIFY_NOTE_MAX_CHARS).join('') : ''
  const reminder = data.kind === 'reminder'
  const urgency: NotifyUrgency = data.urgency === 'immediate' || data.urgency === 'soon' ? data.urgency : 'later'

  return {
    kind: 'notify',
    sourceKey: getEventSourceKey(event),
    eventId: typeof data.eventId === 'string' ? data.eventId : '',
    headline: typeof data.headline === 'string' ? situationContextText(data.headline) : '',
    ...(note ? { note } : {}),
    urgency,
    reminder,
    critical: reminder && event.source === TASK_SCHEDULER_SOURCE && data.payload?.priority === 'critical',
    atMs: nowMs,
  }
}

/**
 * Folds one `spark:notify` event into the leader's situation. The opportunity gate then decides whether the
 * character speaks about it. Any other window forwards the observation to the leader on the speech bus, so a notify
 * that only a follower received (the devtools simulator runs in the settings window) still reaches the situation.
 * Returns the observation, whose topic key names the notify in every window.
 */
export function ingestSparkNotify(event: WebSocketEventOf<'spark:notify'>): NotifyObservation {
  const situation = useSituationStore()
  const observation = notifyObservationFrom(event, Date.now())
  if (situation.leading)
    situation.ingest(observation)
  else
    getSpeechBusContext().emit(situationNotifyObservedEvent, observation)
  return observation
}
