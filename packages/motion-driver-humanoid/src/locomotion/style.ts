import type { GaitBaseline } from '@proj-airi/stage-shared/character-state'

const radians = Math.PI / 180

/**
 * The shape of a walk: how it carries the stride, the pelvis, the torso, the arms and the head. Structure stays the
 * gait's in every style (arm and leg opposition, heel-to-toe roll, the stance from the hips, the contact rules); a style
 * only sizes it. Ratios are 1 and offsets 0 in `NEUTRAL_GAIT_STYLE`, the walk refitted to walking adults on 2026-11-23.
 *
 * Measured across acted walking styles (Bandai Namco Research Motiondataset 1 and 2, 22 styles, CC BY-NC 4.0; 100STYLE,
 * CC BY 4.0; no clip is committed), bounce, arm swing, shoulder twist, elbow carry and trunk lean each vary about
 * four-fold, pelvis twist and list three-fold, step width two-fold, and the step rate at a given speed only by a third.
 * `GAIT_STYLE_BOUNDS` keeps each value inside that range.
 */
export interface GaitStyle {
  /** Walking speed as a share of the speed the urgency asks for. */
  readonly speed: number
  /** Step length at a given speed as a share of the cadence law's; the step rate makes up the rest. */
  readonly stride: number
  /** Below 1 the knees stay softer and the pelvis bobs less; above 1 the pelvis dips deeper at each step. */
  readonly bounce: number
  /** Swing foot height as a share of the gait's. */
  readonly lift: number
  /** Heel-strike and toe-off pitch as a share of the gait's: a stiff or shuffling walk rolls less. */
  readonly roll: number
  /** Pelvis yaw at a full stride as a share of the gait's. */
  readonly pelvisTwist: number
  /** Pelvis list (hip drop) as a share of the gait's. */
  readonly pelvisList: number
  /** Step width as a share of the gait's. */
  readonly width: number
  /** The torso's counter-rotation against the pelvis as a share of the gait's. */
  readonly torsoTwist: number
  /** Arm swing, shoulder and elbow, as a share of the gait's. */
  readonly armSwing: number
  /** Elbow bend carried through the whole swing, radians. */
  readonly elbowCarry: number
  /** Upper-arm abduction added to the walking hang, radians. */
  readonly armOut: number
  /** Trunk pitch, radians, positive forward. */
  readonly lean: number
  /** Neck pitch, radians, positive down; the gaze still aims the head. */
  readonly head: number
}

export type GaitStyleKey = keyof GaitStyle

export const NEUTRAL_GAIT_STYLE: GaitStyle = Object.freeze({
  speed: 1,
  stride: 1,
  bounce: 1,
  lift: 1,
  roll: 1,
  pelvisTwist: 1,
  pelvisList: 1,
  width: 1,
  torsoTwist: 1,
  armSwing: 1,
  elbowCarry: 0,
  armOut: 0,
  lean: 0,
  head: 0,
})

export const GAIT_STYLE_KEYS = Object.keys(NEUTRAL_GAIT_STYLE) as readonly GaitStyleKey[]

/**
 * Each value's range. Ratios span the acted styles' range about the normal walk: speed sad 0.39 to active 1.22 (the
 * urgency sets the rest), bounce 0.35 to 3, arm swing 0.13 to 1.6, elbow carry up to 59 degrees more than normal, trunk
 * lean up to 17 degrees, head carriage up to 36 degrees forward. Head carriage stops at 18 degrees: the gaze must still
 * reach the viewer over it.
 */
export const GAIT_STYLE_BOUNDS: Readonly<Record<GaitStyleKey, readonly [number, number]>> = Object.freeze({
  speed: [0.6, 1.35],
  stride: [0.7, 1.2],
  bounce: [0.4, 2.5],
  lift: [0.6, 1.4],
  roll: [0.6, 1.2],
  pelvisTwist: [0.4, 2],
  pelvisList: [0.4, 2],
  width: [0.4, 2],
  torsoTwist: [0.4, 2],
  armSwing: [0.15, 1.8],
  elbowCarry: [0, 50 * radians],
  armOut: [-4 * radians, 12 * radians],
  lean: [-4 * radians, 14 * radians],
  head: [-8 * radians, 18 * radians],
})

export type MutableGaitStyle = { -readonly [K in GaitStyleKey]: number }

/** Clamps every value of `style` into `GAIT_STYLE_BOUNDS`, into `out` when given. */
export function boundGaitStyle(style: GaitStyle, out: MutableGaitStyle = { ...style }): GaitStyle {
  for (const key of GAIT_STYLE_KEYS) {
    const [min, max] = GAIT_STYLE_BOUNDS[key]
    const value = Number.isFinite(style[key]) ? style[key] : NEUTRAL_GAIT_STYLE[key]
    out[key] = Math.min(max, Math.max(min, value))
  }
  return out
}

/** A card's walking baseline; the character profile owns its shape and schema. */
export type { GaitBaseline }

/** The external factors a walk's style follows. */
export interface WalkFactors {
  /** The mood the performer reads: valence and arousal in [-1, 1], tension in [0, 1]. */
  readonly mood: { readonly valence: number, readonly arousal: number, readonly tension: number }
  /** The host energy handed to Natural, 0 to 1, 0.5 at rest. */
  readonly energy: number
  readonly baseline?: GaitBaseline
}

/** The resting tension of the default character profile: tension below it does not loosen the walk. */
const restingTension = 0.15

function unit(value: number | undefined, min = -1) {
  return Number.isFinite(value) ? Math.min(1, Math.max(min, value as number)) : 0
}

/**
 * A walk's style from her mood, her energy and her baseline. Each value moves from the baseline by signed gains on the
 * factors, in log space for ratios, and is then bounded. The signs follow acted walks (Bandai Namco Research
 * Motiondataset 1 and 2, 100STYLE; measured 2026-11-23) and Roether, Omlor, Christensen and Giese 2009 (J Vision 9(6):15):
 *
 * - Arousal (sad to happy, active, angry) carries the most: speed, bounce (0.015 to 0.129 L), arm swing (21 to 100
 *   degrees), foot lift and twist all rise with it.
 * - Valence moves head and trunk carriage and the arm swing: not-confident and sad walks carry the head 13 to 36 degrees
 *   further forward than a normal walk, with the arms nearly still; proud walks carry it back.
 * - Tension bends the elbows (44 to 73 degrees), shrinks the swing, the roll and the foot lift, and leans the trunk.
 * - Low energy is fatigue: trunk and head forward, shorter steps, less arm swing, a wider stance; the bounce stays.
 *
 * The gains are sized so a factor at its end reaches about the end style; the values are a visual review's to settle.
 * Neutral factors give exactly `NEUTRAL_GAIT_STYLE`.
 */
export function walkStyleFrom(factors: WalkFactors, out: MutableGaitStyle = { ...NEUTRAL_GAIT_STYLE }): GaitStyle {
  const vigor = (unit(factors.energy, 0) - 0.5) * 2
  const a = unit(unit(factors.mood.arousal) + 0.4 * vigor)
  const v = unit(factors.mood.valence)
  const t = Math.max(0, unit(factors.mood.tension, 0) - restingTension) / (1 - restingTension)
  const f = 0.6 * Math.max(0, -vigor)
  const up = Math.max(0, a)
  const sad = Math.max(0, -v)
  const glad = Math.max(0, v)
  const base = factors.baseline ?? {}
  const b = (key: keyof GaitBaseline) => unit(base[key])
  out.speed = Math.exp(0.2 * a + 0.06 * v - 0.2 * f)
  // Acted happy and angry walks step faster with steps of about normal length, so rising arousal takes back the step
  // length its speed would add; falling arousal shortens the step as well as slowing it.
  out.stride = Math.exp(0.07 * Math.min(0, a) - 0.1 * up + 0.05 * v - 0.15 * t - 0.2 * f + 0.15 * b('stride'))
  out.bounce = Math.exp(0.75 * a + 0.2 * v - 0.5 * t + 0.6 * b('bounce'))
  out.lift = Math.exp(0.15 * a - 0.3 * t - 0.2 * f)
  out.roll = Math.exp(0.1 * a - 0.35 * t - 0.2 * f)
  out.pelvisTwist = Math.exp(0.2 * a - 0.3 * t + 0.35 * b('sway'))
  out.pelvisList = Math.exp(0.15 * a + 0.15 * v - 0.3 * t + 0.6 * b('sway'))
  out.width = Math.exp(0.4 * f + 0.1 * t + 0.6 * b('width'))
  out.torsoTwist = Math.exp(0.35 * a + 0.15 * v - 0.4 * t)
  out.armSwing = Math.exp(0.5 * a + 0.35 * v - 0.8 * t - 0.5 * f + 0.5 * b('armSwing'))
  out.elbowCarry = radians * (18 * up + 28 * t + 20 * Math.max(0, b('armCarry')))
  out.armOut = radians * 3 * b('armCarry')
  out.lean = radians * (6 * f + 4 * sad + 4 * t - 3 * b('posture'))
  out.head = radians * (12 * sad + 10 * f - 5 * glad * (1 - up) - 6 * b('posture'))
  return boundGaitStyle(out, out)
}

/** Moves `from` toward `to` by `share` in place: the walk eases into a new style instead of stepping to it. */
export function easeGaitStyle(from: MutableGaitStyle, to: GaitStyle, share: number) {
  for (const key of GAIT_STYLE_KEYS)
    from[key] += (to[key] - from[key]) * share
}
