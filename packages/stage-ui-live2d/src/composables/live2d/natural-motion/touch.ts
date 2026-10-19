import type { Live2DTouchRegion } from '../touch-gestures'
import type { Vec3 } from './posture'

/** Face offsets of a pet, in the units of `NaturalFaceOutput`. */
export interface PetFace {
  /** Multiplies eye openness; the adapter keeps open lids above its eyelid floor. */
  eyeOpenMultiplier: number
  eyeSmile: number
  mouthForm: number
  cheek: number
  browY: number
}

// A pet fades in over about a second and out over about two, so a short pause between
// strokes dips the face slightly instead of snapping it open.
const attackTau = 0.35
const releaseTau = 0.7
// The head follows the hand with a short lag, so it rocks with each stroke.
const handTau = 0.25

// Full-pet pose. The head bows slightly and rolls toward the hand; the roll sign is
// tuned on screen with the reference rigs.
const petPitch = -0.12
const petRoll = -0.22
const petFace: PetFace = { eyeOpenMultiplier: 0.25, eyeSmile: 0.7, mouthForm: 0.4, cheek: 0.6, browY: 0.15 }
// Posture drift calms to this share of its amplitude while fully petted.
const petPostureAmplitude = 0.4

/**
 * Head direction of a poke at `x` (-1 left of center, 1 right), as a nudge direction of
 * length at most 1: the head turns and rolls away from the poke and lifts as if startled.
 * A head poke moves more than a body poke.
 */
export function pokeDirection(region: Live2DTouchRegion, x: number): Vec3 {
  const side = Math.max(-1, Math.min(1, x))
  return region === 'head'
    ? [-0.45 * side, 0.6, 0.45 * side]
    : [-0.3 * side, 0.35, 0.2 * side]
}

/**
 * Poke intensities: the nudge and the surprise impulse it starts.
 *
 * A poke is a physical push, so its nudge exceeds the emotion range on purpose: at
 * intensity 1 the head peaks near 2 degrees on a ±30 rig, which measured as barely
 * visible on the stage. A head nudge of 2.5 peaks near 0.23 normalized.
 */
export const pokeStrength: Record<Live2DTouchRegion, { nudge: number, surprise: number }> = {
  head: { nudge: 2.5, surprise: 1 },
  body: { nudge: 1.5, surprise: 0.6 },
}

/** Seconds the poked character keeps looking at the camera before her gaze wanders again. */
export const pokeGlanceHold = 0.9

/** Seconds after a poke's surprise during which another poke only flinches, so repeated pokes do not stack surprise. */
export const pokeSurpriseDedupeSeconds = 2

/**
 * Continuous pet response: a level that fades in while the user pets the head and out
 * after, and the pose and face offsets it scales.
 *
 * Deterministic and exactly neutral at level 0 (zero offsets, unit multipliers), so a
 * character nobody pets moves exactly as before. Time is seconds of active motion; the
 * facade steps it on its fixed grid.
 */
export class NaturalPetLayer {
  level = 0
  private target = 0
  private hand = 0
  private handTarget = 0

  /** Whether a pet is in progress; the facade suppresses cursor attention while it is. */
  get active() {
    return this.target === 1
  }

  /** Starts or continues a pet with the hand at `hand` (-1 left of the head center, 1 right), or ends it with `null`. */
  set(hand: number | null) {
    this.target = hand === null ? 0 : 1
    if (hand !== null)
      this.handTarget = Math.max(-1, Math.min(1, hand))
  }

  step(dt: number) {
    if (this.level === 0 && this.target === 0)
      return
    const tau = this.target > this.level ? attackTau : releaseTau
    this.level += (this.target - this.level) * (1 - Math.exp(-dt / tau))
    this.hand += (this.handTarget - this.hand) * (1 - Math.exp(-dt / handTau))
    // Settle exactly at rest so the neutral guarantee holds after a pet.
    if (this.target === 0 && this.level < 1e-4) {
      this.level = 0
      this.hand = 0
    }
  }

  headOffset(): Vec3 {
    return [0, petPitch * this.level, petRoll * this.level * this.hand]
  }

  get postureAmplitudeScale() {
    return 1 - (1 - petPostureAmplitude) * this.level
  }

  face(): PetFace {
    const level = this.level
    return {
      eyeOpenMultiplier: 1 - (1 - petFace.eyeOpenMultiplier) * level,
      eyeSmile: petFace.eyeSmile * level,
      mouthForm: petFace.mouthForm * level,
      cheek: petFace.cheek * level,
      browY: petFace.browY * level,
    }
  }
}
