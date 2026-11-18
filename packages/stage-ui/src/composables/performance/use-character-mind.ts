import { CharacterMind } from '@proj-airi/character-mind'
import { onScopeDispose } from 'vue'

import { useSituationObservabilityStore } from '../../stores/devtools/situation-observability'

/**
 * Creates the character mind of the stage that calls it: one mind per `Stage.vue`, seeded from the platform's
 * random source. The mind keeps its default epoch clock and persists nothing, so every stage starts from the
 * initial state.
 *
 * It feeds the devtools reaction inspector of this window: the voice memory from the start, the voice decision of
 * every touch that had a voice view, and the memory after every outcome. The listener stops with the calling scope,
 * which also clears the inspector's memory.
 */
export function useCharacterMind(): CharacterMind {
  const mind = new CharacterMind({ seed: crypto.getRandomValues(new Uint32Array(1))[0] })
  const observability = useSituationObservabilityStore()
  observability.publishReactionMemory(mind.state.voice.reaction)
  const stop = mind.onStep(({ atMs, stimuli, state }) => {
    const { lastDecision, reaction } = state.voice
    if (lastDecision && stimuli.some(stimulus => stimulus.kind === 'touch' && stimulus.voice !== null && stimulus.gesture !== 'pet-start'))
      observability.recordReactionDecision(lastDecision, reaction, atMs)
    else if (stimuli.some(stimulus => stimulus.kind === 'voice-outcome'))
      observability.publishReactionMemory(reaction)
  })
  onScopeDispose(() => {
    stop()
    observability.publishReactionMemory(null)
  })

  return mind
}
