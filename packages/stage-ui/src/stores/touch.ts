import type { TouchObservation } from '@proj-airi/stage-shared/situation'
import type { Live2DTouchEvent } from '@proj-airi/stage-ui-live2d/composables/live2d/touch-gestures'

import type { StagePerformanceConductor } from '../composables/performance/use-stage-performance-conductor'

import { errorMessageFrom } from '@moeru/std'
import { defineStore } from 'pinia'

import { getSpeechBusContext } from '../services/speech/bus'
import { situationTouchObservedEvent } from './situation/touch-bus'

/** The conductor surface a touch reaches. */
type TouchConductor = Pick<StagePerformanceConductor, 'touch'>

/**
 * Routes the touches of a rendered Live2D stage. Lives in the stage window: `Stage.vue` hands each scene `touch` event
 * here together with its own conductor. Only the Natural driver classifies touches, so Universal and MAGIC never
 * reach this store.
 *
 * Every event becomes a `touch` affect signal on that conductor, whose decider owns pacing and habituation and whose
 * mood doses reach the Natural scene. A finished pet and a poke are also forwarded to the leader's situation store as
 * a {@link TouchObservation} over {@link situationTouchObservedEvent}; a pet start is not, because the situation
 * reports a pet once, when it ends.
 *
 * Each rendered stage owns its own conductor, so mood, cooldowns, and habituation are per stage. When two stages
 * render at once (for example in two windows), each touched stage doses its own mood: touching both doses twice as
 * often as touching one, and the leader receives one observation per touch from each of them.
 */
export const useStageTouchStore = defineStore('stage-touch', () => {
  function touch(event: Live2DTouchEvent, conductor: TouchConductor) {
    if (event.kind === 'pet-start') {
      conductor.touch({ touch: 'pet-start', region: 'head' })
      return
    }

    const atMs = Date.now()
    let observation: TouchObservation
    if (event.kind === 'pet-end') {
      conductor.touch({ touch: 'pet-end', region: 'head', durationSeconds: event.durationMs / 1000 })
      observation = { kind: 'touch', gesture: 'pet', region: 'head', atMs, durationMs: event.durationMs }
    }
    else {
      conductor.touch({ touch: 'poke', region: event.region })
      observation = { kind: 'touch', gesture: 'poke', region: event.region, atMs }
    }
    getSpeechBusContext().emit(situationTouchObservedEvent, observation).catch(error => console.error('[stage-touch] Forwarding a touch to the situation leader failed:', errorMessageFrom(error)))
  }

  return { touch }
})
