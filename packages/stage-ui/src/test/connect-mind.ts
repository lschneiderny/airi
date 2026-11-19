import type { useSituationStore } from '../stores/situation'

import { CharacterMind } from '@proj-airi/character-mind'

import { MindVoice } from '../composables/performance/mind-voice'

/**
 * Connects a character mind with a fixed seed to the situation store, as the stage that leads does: the store's
 * stimuli reach the mind, and the mind's lines and published voice state reach the store. The mind keeps the default
 * epoch clock, so fake timers drive both.
 */
export function connectMind(store: ReturnType<typeof useSituationStore>, seed: number) {
  const mind = new CharacterMind({ seed })
  // A test has no body, so cues go nowhere.
  const voice = new MindVoice(mind, () => store, () => {})
  const disconnect = store.connect(stimulus => voice.answer(stimulus))
  return { mind, voice, disconnect }
}
