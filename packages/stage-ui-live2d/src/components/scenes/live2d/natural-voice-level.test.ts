import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { NaturalSpeechEmphasis } from '@proj-airi/motion-driver-natural/speech-emphasis'
import { describe, expect, it } from 'vitest'

import { naturalVoiceLevel } from './natural-voice-level'

const step = 1 / 120

describe('naturalVoiceLevel', () => {
  // Regression: Model.vue divided the mouth opening by 100, so Stage's 0-0.7 lipsync level
  // reached the detector as at most 0.007 and no speech onset could ever fire.
  it('lets Stage-scale lipsync pulses trigger speech emphasis onsets', () => {
    const emphasis = new NaturalSpeechEmphasis(createRandomStream(1))
    // Five 0.7 mouth pulses (0.3 s open, 1.7 s closed), the lipsync cap on loud syllables.
    for (let i = 1; i < 10 / step; i++) {
      const mouthOpenSize = (i * step) % 2 < 0.3 ? 0.7 : 0
      emphasis.step(step, naturalVoiceLevel(mouthOpenSize), 1)
    }
    expect(emphasis.onsetCount).toBe(5)
    expect(emphasis.emphasisCount).toBe(5)
  })
})
