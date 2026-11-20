import type { MindRandom } from './types'

import { nextRandom, seedRng } from '@proj-airi/stage-shared/situation'

/** A Mulberry32 stream from `seed`: the same seed gives the same draws. */
export function seededRandom(seed: number): MindRandom {
  let checkpoint = seedRng(seed)

  return () => {
    const [value, next] = nextRandom(checkpoint)
    checkpoint = next
    return value
  }
}

/**
 * A Mulberry32 stream over a checkpoint kept in the mind's state; `checkpoint()` reads where it stopped, and
 * `restore` rewinds it. A policy with its own stream stores the checkpoint, so a JSON round trip continues it.
 */
export function checkpointStream(start: number) {
  let checkpoint = start
  return {
    random: (): number => {
      const [value, next] = nextRandom(checkpoint)
      checkpoint = next
      return value
    },
    checkpoint: () => checkpoint,
    restore: (to: number) => {
      checkpoint = to
    },
  }
}

/** A 32-bit seed drawn from `random`. */
export function drawSeed(random: MindRandom) {
  return Math.floor(random() * 2 ** 32) >>> 0
}
