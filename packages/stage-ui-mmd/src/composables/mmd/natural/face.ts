import type { NaturalMotionFrame } from '@proj-airi/motion-driver-natural/natural-motion'

import type { MorphSlot } from '../../../constants/morphs'
import type { createMMDMorphRuntime } from '../morph-runtime'

import { MORPH_CANDIDATES } from '../../../constants/morphs'

/** Natural face is lowest priority; speech and expression layers retain ownership. */
export function applyNaturalFace(
  runtime: ReturnType<typeof createMMDMorphRuntime>,
  frame: NaturalMotionFrame,
  overrides: Readonly<Partial<Record<MorphSlot, string>>> = {},
): void {
  const { face } = frame
  const weights = new Map<string, number>()
  const resolve = (slot: MorphSlot) => {
    const requested = overrides[slot]
    if (requested && runtime.morphs.some(morph => morph.name === requested))
      return requested
    return MORPH_CANDIDATES[slot].find(candidate => runtime.morphs.some(morph => morph.name === candidate))
  }
  const add = (slot: MorphSlot, weight: number) => {
    const name = resolve(slot)
    if (name)
      weights.set(name, Math.max(weights.get(name) ?? 0, Math.max(0, Math.min(1, weight))))
  }
  for (const side of ['Left', 'Right'] as const) {
    const y = side === 'Left' ? face.browLY : face.browRY
    const angle = side === 'Left' ? face.browLAngle : face.browRAngle
    add(`browTroubled${side}`, -y)
    add(`browSerious${side}`, y)
    add(`browAngry${side}`, -angle)
  }
  add('lid', Math.max(0, 1 - face.eyeOpenMultiplier - face.eyeOpenHint))
  add('smile', face.eyeSmile + Math.max(0, face.mouthForm))
  add('vowelI', Math.max(0, face.mouthForm) * 0.2)
  add('vowelU', Math.max(0, -face.mouthForm) * 0.2)
  add('vowelA', face.silentMouthOpen)
  for (const [name, weight] of weights)
    runtime.setChannel('naturalFace', name, weight)
  const blink = resolve('blink')
  if (blink)
    runtime.setChannel('blink', blink, 1 - frame.blink.blinkFactor, { alpha: frame.blink.blinkFactor < 1 ? 1 : 0 })
}
