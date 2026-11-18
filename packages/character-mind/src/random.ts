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
