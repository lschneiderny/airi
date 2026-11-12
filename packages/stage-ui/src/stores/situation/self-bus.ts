import type { SelfObservation } from '@proj-airi/stage-shared/situation'

import { defineEventa } from '@moeru/eventa'

/**
 * Something the character did on her own on a rendered stage, for the leader's situation store. The stage window's
 * self store emits it on the speech bus (`getSpeechBusContext`); an emit also reaches listeners in the emitting
 * window, so a stage window that leads receives its own reports through the same listener as a follower's.
 *
 * `atMs` is the emitter's `Date.now()`. The payload is not validated here; the situation reducer drops unknown
 * activities and phases.
 */
export const situationSelfObservedEvent = defineEventa<SelfObservation>('eventa:situation:self-observed')
