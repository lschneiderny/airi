import { CharacterMind } from '@proj-airi/character-mind'

/**
 * Creates the character mind of the stage that calls it: one mind per `Stage.vue`, seeded from the platform's
 * random source. The mind keeps its default epoch clock and persists nothing, so every stage starts from the
 * initial state.
 */
export function useCharacterMind(): CharacterMind {
  return new CharacterMind({ seed: crypto.getRandomValues(new Uint32Array(1))[0] })
}
