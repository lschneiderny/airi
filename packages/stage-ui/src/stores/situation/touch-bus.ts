import type { TouchObservation } from '@proj-airi/stage-shared/situation'

import { defineEventa } from '@moeru/eventa'

/**
 * A touch on a rendered stage, for the leader's situation store. The stage window's touch store emits it on the
 * speech bus (`getSpeechBusContext`) for every finished pet and every poke; a pet start is never sent. An emit also
 * reaches listeners in the emitting window, so a stage window that leads receives its own touches through the same
 * listener as a follower's.
 *
 * `atMs` is the emitter's `Date.now()` and a pet always reports `region: 'head'`, because the stage classifier only
 * recognizes pets over the head. The payload is not validated here; the situation reducer drops unknown gestures and
 * regions.
 */
export const situationTouchObservedEvent = defineEventa<TouchObservation>('eventa:situation:touch-observed')
