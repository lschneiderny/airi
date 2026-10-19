import type { NaturalFaceOutput } from './face'
import type { NaturalHoldLayer } from './hold'
import type { NaturalImpulses } from './impulses'
import type { NaturalPetLayer } from './touch'

/** The held emotion layer and the accent damping it applies while its level is above zero. */
export interface HeldFaceInput {
  hold: NaturalHoldLayer
  accentScale: number
}

/** Adds emotion face hints, the pet face, and the held emotion face to the face layer output; with none active every value is unchanged. */
export function withHints(face: NaturalFaceOutput, time: number, impulses: NaturalImpulses, petLayer: NaturalPetLayer, moodMouthForm: number, held?: HeldFaceInput): NaturalFaceOutput {
  const hints = impulses.hints(time, held && held.hold.emotion
    ? { emotion: held.hold.emotion, scale: 1 - held.accentScale * held.hold.level }
    : undefined)
  const pet = petLayer.face()
  const result = {
    ...face,
    eyeOpenMultiplier: face.eyeOpenMultiplier * pet.eyeOpenMultiplier,
    eyeOpenHint: face.eyeOpenHint + hints.eyeOpen,
    browY: face.browY + hints.browY + pet.browY,
    browAngle: face.browAngle + hints.browAngle,
    browLY: face.browLY + hints.browY + hints.browLY + pet.browY,
    browRY: face.browRY + hints.browY + hints.browRY + pet.browY,
    browLAngle: face.browLAngle + hints.browAngle,
    browRAngle: face.browRAngle + hints.browAngle,
    eyeSmile: face.eyeSmile + hints.eyeSmile + pet.eyeSmile,
    mouthForm: face.mouthForm + hints.mouthForm + pet.mouthForm + moodMouthForm,
    cheek: face.cheek + pet.cheek,
  }
  if (held) {
    const hold = held.hold.face()
    const share = 1 - petLayer.level
    result.eyeOpenMultiplier *= 1 + (hold.eyeOpenMultiplier - 1) * share
    // Additive lid hints and one-sided brow raises overlap pet channels too.
    result.eyeOpenHint += hold.eyeOpenHint * share
    result.browY += hold.browY * share
    result.browLY += (hold.browY + Math.max(0, hold.oneSidedBrow)) * share
    result.browRY += (hold.browY + Math.max(0, -hold.oneSidedBrow)) * share
    result.browAngle += hold.browAngle
    result.browLAngle += hold.browAngle
    result.browRAngle += hold.browAngle
    result.eyeSmile += hold.eyeSmile * share
    result.mouthForm += hold.mouthForm * share
    result.cheek += hold.cheek * share
    result.silentMouthOpen += hold.mouthOpen
  }
  return result
}
