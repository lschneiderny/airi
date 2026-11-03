/**
 * A slow resting face set from outside the driver, for example from the character's longer-lived mood.
 * Every field is an offset that is neutral at 0; the driver applies the filtered value on every grid step.
 */
export interface FaceBaseline {
  /** Added to `mouthForm`; positive smiles. */
  mouthForm: number
  /** Multiplies eye openness by `1 + eyeOpen`. */
  eyeOpen: number
  /** Scales newly drawn blink intervals by `1 / (1 + blinkRateOffset)`; positive blinks more often. Clamped to [-0.4, 0.4]. */
  blinkRateOffset: number
  /** Added to `browAngle`; positive is the worried brow that the sad emotion uses. */
  browAngle: number
}

/** Seconds of the first-order filter toward a new baseline target. */
export const faceBaselineTau = 1.5
const maxBlinkRateOffset = 0.4

const keys = ['mouthForm', 'eyeOpen', 'blinkRateOffset', 'browAngle'] as const

/** Returns the neutral baseline. */
export function neutralFaceBaseline(): FaceBaseline {
  return { mouthForm: 0, eyeOpen: 0, blinkRateOffset: 0, browAngle: 0 }
}

/** First-order filter from the current baseline toward its target; at a zero target it stays exactly zero. */
export class FaceBaselineFilter {
  readonly value = neutralFaceBaseline()
  private readonly target = neutralFaceBaseline()

  /** Nonfinite fields count as 0. */
  set(baseline: Readonly<FaceBaseline>) {
    for (const key of keys)
      this.target[key] = Number.isFinite(baseline[key]) ? baseline[key] : 0
    this.target.blinkRateOffset = Math.max(-maxBlinkRateOffset, Math.min(maxBlinkRateOffset, this.target.blinkRateOffset))
  }

  step(dt: number) {
    const k = 1 - Math.exp(-dt / faceBaselineTau)
    for (const key of keys)
      this.value[key] += (this.target[key] - this.value[key]) * k
  }
}
