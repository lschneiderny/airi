import type { MindStep } from '@proj-airi/character-mind'
import type { ReactionDecision } from '@proj-airi/stage-shared/situation'

import { CharacterMind } from '@proj-airi/character-mind'
import { onScopeDispose } from 'vue'

import { useSituationObservabilityStore } from '../../stores/devtools/situation-observability'

/**
 * The voice decision a step made, or null when none of its stimuli reached the voice policy: only a poke or a
 * finished pet with a voice view does. The state keeps the last decision between steps, so it alone cannot tell.
 */
export function voiceDecisionOf({ stimuli, state }: Pick<MindStep, 'stimuli' | 'state'>): ReactionDecision | null {
  const decided = stimuli.some(stimulus => stimulus.kind === 'touch' && stimulus.voice !== null && stimulus.gesture !== 'pet-start')
  return decided ? state.voice.lastDecision : null
}

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
  const stop = mind.onStep((step) => {
    const { reaction } = step.state.voice
    const decision = voiceDecisionOf(step)
    if (decision)
      observability.recordReactionDecision(decision, reaction, step.atMs)
    else if (step.stimuli.some(stimulus => stimulus.kind === 'voice-outcome'))
      observability.publishReactionMemory(reaction)
  })
  onScopeDispose(() => {
    stop()
    observability.publishReactionMemory(null)
  })

  return mind
}
