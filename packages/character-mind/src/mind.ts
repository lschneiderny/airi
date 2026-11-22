import type { MoodLevel } from './mood'
import type { MindIntent, MindRandom, MindSlowState, MindState, MindStimulus, Refusal } from './types'

import { moodLevelAt } from './mood'
import { seededRandom } from './random'
import { initialMindState, step } from './step'

/** One call of the core, as a listener sees it. */
export interface MindStep { atMs: number, stimuli: readonly MindStimulus[], intents: readonly MindIntent[], refusals: readonly Refusal[], state: MindState }

/**
 * The shell around {@link step}: it owns the clock, the random source, and the state. The app constructs one, in the
 * window's `useCharacterMindStore`. It persists nothing itself: the host saves `state.slow` and hands it back through
 * the `slow` option or {@link reset}; everything else starts from the initial state.
 */
export class CharacterMind {
  private current: MindState
  private previousAtMs = Number.NEGATIVE_INFINITY
  private readonly clock: () => number
  private readonly rng: MindRandom
  private readonly listeners = new Set<(step: MindStep) => void>()

  /** `seed` starts the random source; `clock` returns epoch milliseconds; `slow` is the slow state the host loaded. */
  constructor(options: { seed: number, clock?: () => number, slow?: MindSlowState }) {
    this.clock = options.clock ?? Date.now
    this.rng = seededRandom(options.seed)
    this.current = initialMindState(options.slow)
  }

  get state(): MindState {
    return this.current
  }

  /**
   * Starts the mind over from `slow`, for a host that loaded another slow state. The random stream continues, and the
   * clock stays monotonic: the next step is never earlier than the last one. Listeners stay and see no step for it.
   */
  reset(slow: MindSlowState): void {
    this.current = initialMindState(slow)
  }

  /** Answers the stimuli now and returns the intents. */
  receive(...stimuli: MindStimulus[]): MindIntent[] {
    // The rules drop a stimulus older than the last one, so a clock that steps back must not reach them.
    const atMs = Math.max(this.previousAtMs, this.clock())
    this.previousAtMs = atMs
    const { state, intents, refusals } = step(this.current, stimuli, atMs, this.rng)
    this.current = state
    for (const listener of this.listeners)
      listener({ atMs, stimuli, intents, refusals, state })

    return intents
  }

  /**
   * Her fast mood decayed to now, to seed a Natural performer that attaches, is rebuilt, or becomes Natural again. A
   * performer reads it once at that moment and decays its copy on its own clock afterwards; it is not a frame input.
   */
  moodLevel(): MoodLevel {
    return moodLevelAt(this.current.mood, Math.max(this.previousAtMs, this.clock()))
  }

  /** Calls the listener after every step; returns the function that stops it. */
  onStep(listener: (step: MindStep) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
