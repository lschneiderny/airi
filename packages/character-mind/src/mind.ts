import type { MindIntent, MindRandom, MindState, MindStimulus } from './types'

import { seededRandom } from './random'
import { initialMindState, step } from './step'

/** One call of the core, as a listener sees it. */
export interface MindStep { atMs: number, stimuli: readonly MindStimulus[], intents: readonly MindIntent[], state: MindState }

/**
 * The shell around {@link step}: it owns the clock, the random source, and the state. It runs in the window that
 * hosts the stage and persists nothing, so every mind starts from the initial state.
 */
export class CharacterMind {
  private current: MindState
  private previousAtMs = Number.NEGATIVE_INFINITY
  private readonly clock: () => number
  private readonly rng: MindRandom
  private readonly listeners = new Set<(step: MindStep) => void>()

  /** `seed` starts the random source; `clock` returns epoch milliseconds. */
  constructor(options: { seed: number, clock?: () => number }) {
    this.clock = options.clock ?? Date.now
    this.rng = seededRandom(options.seed)
    this.current = initialMindState()
  }

  get state(): MindState {
    return this.current
  }

  /** Answers the stimuli now and returns the intents. */
  receive(...stimuli: MindStimulus[]): MindIntent[] {
    // The rules drop a stimulus older than the last one, so a clock that steps back must not reach them.
    const atMs = Math.max(this.previousAtMs, this.clock())
    this.previousAtMs = atMs
    const { state, intents } = step(this.current, stimuli, atMs, this.rng)
    this.current = state
    for (const listener of this.listeners)
      listener({ atMs, stimuli, intents, state })

    return intents
  }

  /** Calls the listener after every step; returns the function that stops it. */
  onStep(listener: (step: MindStep) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
