import type { Observation } from '@proj-airi/stage-shared/situation'

import type { StageLiveState } from '../../../composables/use-airi-runtime-prompt'

import { effectScope, watch } from 'vue'

import { useStageLiveState } from '../../../composables/use-airi-runtime-prompt'

/** Matches a situation without a stage line, so an empty stage sends nothing. */
const EMPTY: StageLiveState = Object.freeze({ exposed: '', active: '', mood: '' })

/**
 * Turns the live performance state (exposed expressions, and the active expressions and mood while state
 * feedback is on) into `stage` observations, which the situation block renders as its stage line.
 * An observation is sent only when a field changes. Returns the function that stops watching.
 */
export function startStageSensor(ingest: (observation: Observation) => void): () => void {
  let last = EMPTY
  const scope = effectScope(true)
  scope.run(() => {
    const liveState = useStageLiveState()
    watch(liveState, (next) => {
      if (next.exposed === last.exposed && next.active === last.active && next.mood === last.mood)
        return
      last = next
      ingest({ kind: 'stage', exposed: next.exposed, active: next.active, mood: next.mood, atMs: Date.now() })
    }, { immediate: true, flush: 'sync' })
  })

  return () => scope.stop()
}
