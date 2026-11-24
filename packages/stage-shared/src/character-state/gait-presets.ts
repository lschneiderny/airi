import type { GaitBaseline } from './types'

import { GAIT_BASELINE_KEYS } from './types'

export type GaitBaselinePreset = 'neutral' | 'graceful' | 'bold' | 'light' | 'reserved' | 'heavy'

export const GAIT_BASELINE_PRESET_NAMES = ['neutral', 'graceful', 'bold', 'light', 'reserved', 'heavy'] as const satisfies readonly GaitBaselinePreset[]

/**
 * Walking baselines a card editor offers, each drawn from a family of acted walking styles (Bandai Namco Research
 * Motiondataset 1 and 2, measured 2026-11-23; see `.omo/plans/walk-style.md` section 1) and kept moderate, so her mood
 * still moves the walk. The values are a visual review's to settle.
 */
export const GAIT_BASELINE_PRESETS: Readonly<Record<GaitBaselinePreset, Readonly<Required<GaitBaseline>>>> = Object.freeze({
  neutral: Object.freeze({ stride: 0, sway: 0, width: 0, bounce: 0, armSwing: 0, armCarry: 0, posture: 0 }),
  // Feminine: a narrow track, more pelvis list, a little less bounce and swing, elbows slightly bent.
  graceful: Object.freeze({ stride: 0, sway: 0.6, width: -0.6, bounce: -0.3, armSwing: -0.2, armCarry: 0.3, posture: 0.2 }),
  // Masculinity and proud: a wider track, longer steps, more arm swing, less list, head and trunk carried back.
  bold: Object.freeze({ stride: 0.4, sway: -0.3, width: 0.6, bounce: 0.2, armSwing: 0.4, armCarry: 0, posture: 0.6 }),
  // Youthful and happy: about twice the bounce and a larger arm swing.
  light: Object.freeze({ stride: 0, sway: 0.2, width: -0.2, bounce: 0.8, armSwing: 0.6, armCarry: 0.2, posture: 0.2 }),
  // Not-confident: short steps, arms nearly still and carried bent, head and trunk a little forward.
  reserved: Object.freeze({ stride: -0.4, sway: -0.3, width: 0, bounce: -0.4, armSwing: -0.8, armCarry: 0.6, posture: -0.4 }),
  // Giant and old: a wide track, a deep bounce, shorter steps, head and trunk forward.
  heavy: Object.freeze({ stride: -0.2, sway: 0.3, width: 0.8, bounce: 0.6, armSwing: 0, armCarry: 0.2, posture: -0.4 }),
})

/** The preset whose values `gait` holds, an omitted value counting as 0, or `null` for a custom baseline. */
export function gaitBaselinePresetOf(gait: GaitBaseline | undefined): GaitBaselinePreset | null {
  return GAIT_BASELINE_PRESET_NAMES.find(name => GAIT_BASELINE_KEYS.every(key => (gait?.[key] ?? 0) === GAIT_BASELINE_PRESETS[name][key])) ?? null
}
