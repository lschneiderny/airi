import type { GaitBaseline } from '@proj-airi/stage-shared/character-state'

import { WALK_URGENCY } from '../types'
import { clampUrgency } from './urgency'

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
  /** Wrist extension added to the rest wrist's 10 degrees, radians; negative lets the hand drop toward the forearm's line. */
  readonly wristCarry: number
  /** The hand's closure: 1 the rest hand, blending toward the open hand below 1 and toward a fist above it (a fist at the bound's top). */
  readonly handCurl: number
  /**
   * The push off the trailing foot as a share of the gait's: above 1 the toe-off pitch is deeper and the swing leaves the
   * ground faster, a springy step; below 1 the swing starts slowly, a step that drags. The toe-off never rolls less than
   * the gait's, so the rig's step limit holds for every push.
   */
  readonly push: number
  /** Extra knee give after each heel strike, as a share of the gait's loading dip at a bounce of 2: a loaded, heavy step. */
  readonly load: number
  /** The chest curled forward over the spine, radians, with the shoulders rounded by half of it; negative opens the chest. */
  readonly fold: number
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
  wristCarry: 0,
  handCurl: 1,
  push: 1,
  load: 0,
  fold: 0,
})

export const GAIT_STYLE_KEYS = Object.keys(NEUTRAL_GAIT_STYLE) as readonly GaitStyleKey[]

/**
 * Each value's range. Ratios span the acted styles' range about the normal walk: speed sad 0.39 to active 1.22 (the
 * urgency sets the rest), bounce 0.35 to 3, arm swing 0.13 to 1.6, elbow carry up to 59 degrees more than normal, trunk
 * lean up to 17 degrees, head carriage up to 36 degrees forward. Head carriage stops at 18 degrees: the gaze must still
 * reach the viewer over it. The rest wrist carries 10 degrees of extension; authored walks hold 0 (runs with fists) to 30
 * (feminine and skip walks) and acted mocap walks up to 51. The MMD rig turns the carriage in the frontal plane, where
 * more than about 12 degrees reads as a flared, braced hand from the front (visual review, 2026-11-24), so it stops
 * there; the low end brings the hand in line with the forearm. The rest curl sums
 * 45 degrees over the index finger's three joints; authored walks hold 14 to 17 (an open hand) up to 266 to 294 (a
 * fist), and the curl stops at 3.5 times the rest, where the joint limits close the fist (arm-hand plan, section 1).
 * The push, load and fold bounds rest on judgment, since no reference measures them: a push of 1.5 rolls the toe-off
 * half as far again, a load of 1 gives the knee the loading dip of a bounce of 2, and a fold of 12 degrees is a slump.
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
  wristCarry: [-10 * radians, 12 * radians],
  handCurl: [0.3, 3.5],
  push: [0.6, 1.5],
  load: [0, 1],
  fold: [-4 * radians, 12 * radians],
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
  /** The goal's urgency in [0, 1]; omitted or at most `WALK_URGENCY`, it leaves the style alone. */
  readonly urgency?: number
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
 * - Tension bends the elbows (44 to 73 degrees), shrinks the swing, the roll and the foot lift, and leans the trunk
 *   forward: angry and not-confident walks lean 11 and 14 degrees more than a normal walk.
 * - Low energy is fatigue: trunk and head forward (tired walks lean 11 degrees more), shorter steps, less arm swing, a
 *   wider stance; the bounce stays.
 * - Arousal leans the trunk a little forward too: happy, active and childish walks lean 4 to 8 degrees more.
 * - Urgency above the walk's leans the trunk forward, up to 6 degrees more at urgency 1: rushed and active walks lean
 *   (100STYLE Rushed 11 degrees, set 1 active 4 degrees against normal's 2). The urgency sets the speed elsewhere.
 * - Each mood also shows in the legs and trunk: sad gait has short steps, a flexed upper body and a lowered head,
 *   angry gait heavy steps (Roether, Omlor, Christensen and Giese 2009, J Vis 9(6):15; Montepare, Goldstein and Clausen
 *   1987, J Nonverbal Behav 11:33, who also found happy gait bouncy). Arousal and valence push off the trailing foot harder;
 *   fatigue and sadness let it peel off late and swing slowly. Tension loads each step with knee give after the strike,
 *   most with arousal. Sadness curls the chest, rounds the shoulders and narrows the step, less as arousal rises, and
 *   shortens the step; fatigue curls the chest a little; gladness opens it.
 * - The hand (arm-hand plan, section 1): no acted or authored walk carries the wrist flexed. Happy, childish and feminine
 *   walks extend it most (24 to 51 degrees), sad and proud ones least (5 to 12), masculine walks and runs with fists
 *   hold it near 0. The fingers open in model and feminine walks (summed index curl 14 to 17), curl loosely in normal
 *   walks (43) and close into a fist in masculine, energetic and angry ones (266 to 294).
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
  const hurry = factors.urgency === undefined ? 0 : Math.max(0, clampUrgency(factors.urgency) - WALK_URGENCY) / (1 - WALK_URGENCY)
  // Sadness slows the walk 10 % as it shortens the step 5 %, so a sad walk steps no faster: with a 10 % shorter step at
  // the old speed, the cadence rose from 1.41 to 1.55 steps/s (reference rig), where sad is the slowest acted walk (1.12).
  out.speed = Math.exp(0.2 * a + 0.06 * v - 0.1 * sad - 0.2 * f)
  // Acted happy and angry walks step faster with steps of about normal length, so rising arousal takes back the step
  // length its speed would add; falling arousal shortens the step as well as slowing it.
  out.stride = Math.exp(0.07 * Math.min(0, a) - 0.1 * up + 0.05 * v - 0.05 * sad - 0.15 * t - 0.2 * f + 0.15 * b('stride'))
  out.bounce = Math.exp(0.75 * a + 0.2 * v - 0.5 * t + 0.6 * b('bounce'))
  // Tension stiffens the step, a shuffle with a flat roll, unless arousal drives it: an angry foot lifts and plants
  // through its heel, where a flat, low step under a lunging trunk read as hurrying, not force (independent visual
  // audit, 2026-11-25; angry gait is heavy-footed, Montepare, Goldstein and Clausen 1987).
  const stiff = t * (1 - up)
  out.lift = Math.exp(0.15 * a - 0.3 * stiff - 0.2 * f)
  out.roll = Math.exp(0.1 * a - 0.35 * stiff - 0.2 * f)
  out.pelvisTwist = Math.exp(0.2 * a - 0.3 * t + 0.35 * b('sway'))
  out.pelvisList = Math.exp(0.15 * a + 0.15 * v - 0.3 * t + 0.6 * b('sway'))
  out.width = Math.exp(0.4 * f + 0.1 * t - 0.35 * sad * (1 - up) + 0.6 * b('width'))
  // Tension squares the shoulders to the path: at -0.4 the angry trunk still counter-rotated 8.9 degrees and read as
  // loose (independent visual audit, 2026-11-25).
  out.torsoTwist = Math.exp(0.35 * a + 0.15 * v - 0.8 * t)
  out.armSwing = Math.exp(0.5 * a + 0.35 * v - 0.8 * t - 0.5 * f + 0.5 * b('armSwing'))
  // Arousal bends the elbow, tension holds it lower. Acted angry walks carry it 30 degrees over normal, but 31 here
  // measured 54 on the reference rig and read as pumping arms; the force belongs in the plant and the trunk
  // (independent visual audits, 2026-11-24 and 2026-11-25).
  out.elbowCarry = radians * (18 * up * (1 - t) + 8 * t + 20 * Math.max(0, b('armCarry')))
  out.armOut = radians * 3 * b('armCarry')
  out.lean = radians * (20 * f + 4 * sad + 10 * t + 4 * up - 3 * b('posture') + 6 * hurry)
  // Fatigue bends her from the hips more than at the neck, so the tired walk does not read as the sad one's lowered head
  // (independent visual audit, 2026-11-25): 4 degrees per unit of fatigue, against sadness's 12.
  out.head = radians * (12 * sad + 4 * f - 5 * glad * (1 - up) - 6 * b('posture'))
  // Valence, arousal and a carried arm extend the wrist (acted happy 31 to 38, feminine 31 to 51) at half the acted
  // gain, where the review saw a loose hand; sadness and fatigue drop it (sad 5 to 12); tension straightens it
  // (masculine 0 to 14).
  const down = Math.max(0, -a)
  out.wristCarry = radians * (6 * up + 5 * glad - 7 * sad - 3 * down - 8 * f - 6 * t + 5 * Math.max(0, b('armCarry')))
  // Tension closes the hand, most with arousal (angry; masculine and energetic authored walks hold a fist); a calm
  // positive walk opens it (model and feminine walks: index curl 14 to 17, normal 43); a carried arm opens it, a wide
  // swing closes it a little.
  out.handCurl = Math.exp(0.2 * up + 1.1 * t + 0.6 * up * t - 0.9 * glad * (1 - up) - 0.8 * Math.max(0, b('armCarry')) + 0.4 * Math.max(0, b('armSwing')))
  // Fatigue picks the foot up late and sinks into each landing, a heavy step that sad's folded, narrow walk lacks
  // (independent visual audit, 2026-11-25: tired read as sad); full fatigue nearly reaches the push's floor and half
  // the load. Tension loads the step most with arousal, fully when angry.
  out.push = Math.exp(0.25 * up + 0.15 * glad - 0.2 * sad - 0.8 * f - 0.1 * t)
  out.load = t * (0.4 + 0.75 * up) + 0.8 * f
  // An aroused negative mood is anger, not defeat: the fold and the narrow step fade with arousal.
  out.fold = radians * (9 * sad * (1 - up) + 5 * f - 3 * glad * (1 - t))
  return boundGaitStyle(out, out)
}

/** Moves `from` toward `to` by `share` in place: the walk eases into a new style instead of stepping to it. */
export function easeGaitStyle(from: MutableGaitStyle, to: GaitStyle, share: number) {
  for (const key of GAIT_STYLE_KEYS)
    from[key] += (to[key] - from[key]) * share
}
