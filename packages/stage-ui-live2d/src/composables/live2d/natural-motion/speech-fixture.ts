import { createRandomStream } from '@proj-airi/motion-driver-natural/random'

/**
 * Syllable envelope fixture at `rate` Hz: phrases of 10-16 syllables at 4 Hz, separated by
 * pauses that make up 30% of the time. Each syllable is a raised-sine burst that closes the
 * mouth, with a random peak of 0.5-0.9. Returns the level per frame and the phrase onsets.
 * The liveliness gate's talking check and the QA scenario runner drive `setVoice` with it.
 */
export function syllableFixture(seconds: number, seed: number, rate = 120) {
  const random = createRandomStream(seed)
  const level = new Float64Array(seconds * rate + 1)
  const onsets: number[] = []
  let time = 0.5
  while (time < seconds) {
    const syllables = 10 + Math.floor(7 * random())
    onsets.push(time)
    for (let syllable = 0; syllable < syllables; syllable++) {
      const peak = 0.5 + 0.4 * random()
      const start = time + syllable * 0.25
      for (let frame = Math.ceil(start * rate); frame < (start + 0.25) * rate && frame < level.length; frame++)
        level[frame] = peak * Math.sin(Math.PI * (frame / rate - start) / 0.25) ** 2
    }
    const phrase = syllables * 0.25
    time += phrase + phrase * 0.3 / 0.7
  }
  return { level, onsets }
}
