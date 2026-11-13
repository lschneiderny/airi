import type { BodyChannel, BodySide } from './channels'
import type { BodyArmForm, BodyGazeGoal, BodyIdleAct, BodyIdleKind } from './contracts'
import type { LayerOutput, PerformanceContext, PerformanceLayer, PerformancePlan } from './stack'

import { minJerk } from '../dynamics'
import { armResponse } from './arms'
import { ARM_START, BODY_CHANNELS, BODY_TICK, channelGroup, channelIndex, DEG, SIDES } from './channels'
import { path } from './cues'
import { GestureKeys } from './gesture-forms'
import { followerInverse } from './gestures'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const c = channelIndex
const sideOf = (side: number): BodySide => side < 0 ? 'left' : 'right'

/**
 * Natural's head and body units as the MMD body read them before the performer existed (idle agency ADR, "What it
 * writes"): 30 degrees per head unit, 10 per body unit. A form that keeps one of main's shapes converts it with these.
 */
const NATURAL = { head: 30, body: 10 } as const
/** Architecture 3g: a layer's exit ramp; the shortest fade of a behaviour let go before its end. */
const EXIT = 0.35
/** Natural's look-around glances reach 0.7 aside and 0.22 up (`idle-activities.ts`); architecture 4e act 4 looks 35 deg aside and 20 deg up. */
const LOOK = { yaw: 35 * DEG / 0.7, pitch: 20 * DEG / 0.22 } as const
/** The posture's weight-chain roll per unit of support, lower 2.4, mid 0.9 and upper 0.5 degrees (`posture.ts`), as shares of a trunk roll. */
const ROLL_SHARES = [2.4 / 3.8, 0.9 / 3.8, 0.5 / 3.8] as const
/** Architecture 4b nod: head 0.7 and neck 0.3 of the pitch, torso mid 0.12 of it. */
const NOD = { head: 0.7, neck: 0.3, mid: 0.12 } as const
/** Architecture 4f standing doze, as a nod-off and waking reach it: the head to +18 deg, the torso lower to +3, a 3 deg overshoot up. */
const DOZE = { head: 18, lower: 3, overshoot: 3 } as const
/** Architecture 4f waking: the head lifts with a 15 % overshoot and the clavicles rise 4 deg for 0.4 s. */
const WAKE = { overshoot: 0.15, clavicle: 4, clavicleSeconds: 0.4 } as const
/**
 * The shortest fade, seconds, of a behaviour let go early, when its form needs longer than Natural's release: a
 * stretch's arms take the stretch's own fall and settle (1.6 s), and waking holds until the shoulders' rise has settled.
 */
const OWN_RELEASE: Partial<Record<BodyIdleKind, number>> = { stretch: 1.6, sleep: WAKE.clavicleSeconds + 0.3 }

function trapezoid(age: number, attack: number, hold: number, release: number): number {
  if (age <= 0 || age >= attack + hold + release)
    return 0
  if (age < attack)
    return minJerk(age / attack)
  return age < attack + hold ? 1 : 1 - minJerk((age - attack - hold) / release)
}

const raisedCosine = (u: number) => u <= 0 || u >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * u)

/** Architecture 4e act 2: the two sides of a bilateral act are 120 ms apart. */
const BILATERAL = 0.12
/** The channels a stretch moves in a side's arm block: clavicle elevation, flexion, abduction, elbow. */
const STRETCH_CHANNELS = [0, 2, 3, 5] as const
/**
 * A stretch's arms, degrees: at the top 120 of flexion, the soft limit's identity edge (3g: 80 % of the 150 deg limit),
 * 20 out and nearly straight (10), the clavicles up half of the 4b shrug peak (14); on the way up and down the arm passes
 * out at the corrector's guard abduction (6.2: 45, clear of the body on every rig).
 */
const STRETCH = { clavicle: 7, flex: 120, abduct: 20, elbow: 10, guard: 45 } as const

/** One arm's stretch on this rig: its rest, degrees in `STRETCH_CHANNELS` order, and the elbow it folds to on the way. */
interface StretchArm {
  readonly rest: readonly number[]
  readonly fold: number
}

/**
 * A reaching hand travels a nearly straight line (Morasso 1981, Exp Brain Res 42(2):223-227,
 * https://link.springer.com/article/10.1007/BF00236911). On the line from where a stretching hand hangs to where it
 * reaches, the point nearest the shoulder is where the arm is most folded; the elbow there (law of cosines on the rig's
 * segments) is the one the arm bends to halfway up and halfway down, so the elbows lead instead of the arms swinging
 * straight through a T.
 */
function stretchArm(context: PerformanceContext, side: BodySide): StretchArm {
  const keys = new GestureKeys(context.traits, context.rest)
  const start = ARM_START[side]
  const hanging = Float64Array.from(context.rest.subarray(start, start + 26))
  const raised = hanging.slice()
  raised[2] = STRETCH.flex * DEG
  raised[3] = STRETCH.abduct * DEG
  raised[5] = STRETCH.elbow * DEG
  const from = keys.wrist(side, hanging)
  const to = keys.wrist(side, raised)
  const way = [0, 1, 2].map(k => to[k] - from[k])
  const along = Math.max(0, Math.min(1, -(from[0] * way[0] + from[1] * way[1] + from[2] * way[2]) / (way[0] ** 2 + way[1] ** 2 + way[2] ** 2)))
  const arm = context.traits.arms[side]
  const upper = Math.hypot(arm.upperArm.x, arm.upperArm.y, arm.upperArm.z)
  const forearm = Math.hypot(arm.forearm.x, arm.forearm.y, arm.forearm.z)
  const near = Math.hypot(...[0, 1, 2].map(k => from[k] + along * way[k])) * (upper + forearm)
  const cosine = Math.max(-1, Math.min(1, (upper ** 2 + forearm ** 2 - near ** 2) / (2 * upper * forearm)))
  return { rest: STRETCH_CHANNELS.map(k => hanging[k] / DEG), fold: 180 - Math.acos(cosine) / DEG }
}

/** One behaviour the layer plays; times are performer seconds. */
interface Act {
  readonly record: BodyIdleAct
  readonly start: number
  releaseAt: number | null
  releaseSeconds: number
  /** The gaze goal and the viewer when it started: a look-around aims around the viewer, sleep holds the goal. */
  readonly gaze: BodyGazeGoal
  readonly viewerYaw: number
  /** Natural's mood tension when it started, which sets the arm pendulum's period. */
  readonly tension: number
}

/**
 * Layer 4 of 3g (architecture 4e and 4f, reworked by the idle agency ADR's amendment of 2026-11-13): the whole-body form
 * of the behaviour Natural's idle scheduler started. It decides nothing: it plays `input.idle` from the tick it sees a
 * new `seq`, fades out over the release a behaviour let go before its end carries, and stays at weight 0 without one.
 *
 * - Every term is additive, starts at zero with zero slope and returns to zero, so the stack needs no ramp; a new
 *   behaviour while another fades is a cut the stack inertialises.
 * - The head of an act is the performer's: Natural's head offsets reach only the frame Live2D draws. A form that keeps
 *   one of main's shapes converts it at the units the MMD body used before (`NATURAL`).
 * - Arms that reach a place go through `plan.armForm`, so the gesture layer solves, clears and retracts them as it does
 *   an emotion's hand; a weight shift goes through `plan.support`; a look goes through `plan.gaze`.
 * - Owned groups receive no term and plan nothing, and a walking gait takes the act away.
 * - Variation inside a form (the doze's nod-off times) comes from a stream seeded by the behaviour's `seq`.
 */
export function createActLayer(): PerformanceLayer {
  const channels = new Float64Array(BODY_CHANNELS.length)
  const output: Mutable<LayerOutput> = { channels, weight: 0, sequence: 0 }
  let plan: Mutable<PerformancePlan> = {}
  let act: Act | null = null
  /** The latest behaviour played; a finished one stays in the input and must not replay. */
  let playedSeq: number | null = null
  /** Each arm's stretch on this rig (`stretchArm`), found at the first stretch. */
  let arms: Record<BodySide, StretchArm> | null = null
  let tick = -1

  function update(context: PerformanceContext): void {
    if (context.tick === tick)
      return
    tick = context.tick
    const { input, time } = context
    const record = input.idle
    if (record && record.seq !== playedSeq && record.release === null) {
      playedSeq = record.seq
      act = {
        record,
        start: time,
        releaseAt: null,
        releaseSeconds: 0,
        gaze: { yaw: input.gaze.yaw, pitch: input.gaze.pitch, kind: input.gaze.kind },
        viewerYaw: input.viewerYaw,
        tension: Math.max(0, Math.min(1, input.mood.tension)),
      }
    }
    if (act && record?.seq === act.record.seq && record.release !== null && act.releaseAt === null) {
      act.releaseAt = time
      // Waking keeps the act until the shoulders' wake rise has settled.
      act.releaseSeconds = Math.max(EXIT, record.release, OWN_RELEASE[act.record.kind] ?? 0)
    }
    if (act && (act.releaseAt === null ? time - act.start >= act.record.duration : time - act.releaseAt >= act.releaseSeconds))
      act = null
    channels.fill(0)
    plan = {}
    output.modulation = undefined
    if (act)
      perform(act, context)
  }

  /** Writes the form of `a` at this tick into `channels` and `plan`. */
  function perform(a: Act, context: PerformanceContext): void {
    const { input, time } = context
    const age = time - a.start
    const D = a.record.duration
    const s = a.record.side
    const released = a.releaseAt !== null
    // A sleep's release is her waking, which the sleep form shapes itself.
    const fade = released && a.record.kind !== 'sleep' ? 1 - minJerk((time - (a.releaseAt ?? time)) / a.releaseSeconds) : 1
    const walking = input.gait !== null && input.gait.mode !== 'idle' ? input.gait.weight : 0
    const w = fade * (1 - walking)
    const add = (channel: BodyChannel, degrees: number) => {
      channels[c(channel)] += w * degrees * DEG
    }
    /** Neck and head share a head posture as the posture generator splits it. */
    const head = (yaw: number, pitch: number, roll: number, neck = 0.35) => {
      add('neckYaw', neck * yaw)
      add('neckPitch', neck * pitch)
      add('neckRoll', neck * roll)
      add('headYaw', (1 - neck) * yaw)
      add('headPitch', (1 - neck) * pitch)
      add('headRoll', (1 - neck) * roll)
    }
    /** One of main's normalized head shapes at the MMD units: x yaw, y up, z roll. */
    const naturalHead = (x: number, y: number, z: number) => head(NATURAL.head * x, -NATURAL.head * y, -NATURAL.head * z)
    const clavicles = (degrees: number) => {
      add('leftClavElev', degrees)
      add('rightClavElev', degrees)
    }
    const trunkRoll = (degrees: number) => {
      add('lowerRoll', ROLL_SHARES[0] * degrees)
      add('midRoll', ROLL_SHARES[1] * degrees)
      add('upperRoll', ROLL_SHARES[2] * degrees)
    }
    const free = (groups: readonly ('lowerBody' | 'upperBody')[]) => !released && walking === 0 && groups.every(group => input.owned[group] <= 0.5)
    const reach = (form: BodyArmForm, side: BodySide) => {
      if (!released && walking === 0)
        plan.armForm = { side, form }
    }
    switch (a.record.kind) {
      case 'stretch': {
        // Bertolucci 2011 (J Bodyw Mov Ther 15(3):268-280, https://pubmed.ncbi.nlm.nih.gov/21665102/): pandiculation
        // extends the limbs and the trunk. Natural's timing: rise 1.3 s, hold 1.6 s, fall 1.1 s, a lower settle. The
        // trunk extends half of each control's limit (6.4); the arms follow `stretchArm`.
        const e = trapezoid(age, 1.3, 1.6, 1.1)
        const settle = raisedCosine((age - 3.5) / 1.7)
        add('lowerPitch', -6 * e)
        add('midPitch', -5 * e + NATURAL.body * 0.2 * settle)
        add('upperPitch', -3 * e)
        naturalHead(s * 0.1 * e, 0.45 * e - 0.14 * settle, s * 0.3 * e)
        arms ??= { left: stretchArm(context, 'left'), right: stretchArm(context, 'right') }
        const tension = Math.max(0, Math.min(1, input.mood.tension))
        for (const side of SIDES) {
          const { rest, fold } = arms[side]
          // The arm away from `s` follows 120 ms later, the two sides' offset of 4e act 2.
          const lag = side === sideOf(s) ? 0 : BILATERAL
          const pose = (at: number) => {
            const t = at - a.start - lag
            const raise = trapezoid(t, 1.3, 1.6, 1.1)
            const out = t <= 0 ? 0 : path(t, [[0.65, STRETCH.guard - rest[2]], [1.3, STRETCH.abduct - rest[2]], [2.9, STRETCH.abduct - rest[2]], [3.6, STRETCH.guard - rest[2]], [D - lag, 0]])
            const elbow = t <= 0 ? 0 : path(t, [[0.65, fold - rest[3]], [1.3, STRETCH.elbow - rest[3]], [2.9, STRETCH.elbow - rest[3]], [3.45, fold - rest[3]], [4, 0]])
            if (a.releaseAt === null || at < a.releaseAt)
              return [STRETCH.clavicle * raise, raise * (STRETCH.flex - rest[1]), out, elbow]
            // Let go early, the arm leaves its course over 3g's exit ramp and comes down over the release, out at the
            // guard abduction in its first third, as on its own fall, then in.
            const since = at - a.releaseAt
            const kept = 1 - minJerk(since / a.releaseSeconds)
            const leave = minJerk(since / EXIT)
            const up = raise + (trapezoid(a.releaseAt - a.start - lag, 1.3, 1.6, 1.1) * kept - raise) * leave
            const aside = path(since / a.releaseSeconds, [[0.35, STRETCH.guard - rest[2]], [1, 0]])
            return [STRETCH.clavicle * up, up * (STRETCH.flex - rest[1]), out + (aside - out) * leave, elbow * kept]
          }
          const before = pose(time - BODY_TICK)
          const now = pose(time)
          const after = pose(time + BODY_TICK)
          for (let i = 0; i < STRETCH_CHANNELS.length; i++) {
            // Under an additive layer the arm's followers are relaxed (3a) and swing past a moving target; the arm gets
            // its offsets through their inverse, as the gesture layer feeds its held forms, so it keeps to its course.
            const [lead, curvature] = i === 0 ? [0, 0] : followerInverse(STRETCH_CHANNELS[i], tension, 0)
            const slope = (after[i] - before[i]) / (2 * BODY_TICK)
            const curve = (after[i] - 2 * now[i] + before[i]) / BODY_TICK ** 2
            channels[ARM_START[side] + STRETCH_CHANNELS[i]] += (1 - walking) * (now[i] + lead * slope + curvature * curve) * DEG
          }
        }
        break
      }
      case 'yawn': {
        // Architecture 4e act 9: head pitch -8, torso mid -3, clavicles +5 while it opens, then 4f's slump (torso lower
        // +3); the hand covers the open mouth (`cover-mouth`). Natural's timing (open 1.4 s, hold 1.1 s, close 1.1 s)
        // matches Provine 1986 (Ethology 72(2):109-122): about 6 s.
        const e = trapezoid(age, 1.4, 1.1, 1.1)
        const after = trapezoid(age - 3.4, 0.4, 0.8, 0.8)
        head(0, -8 * e, -NATURAL.head * s * 0.12 * e)
        add('midPitch', -3 * e)
        add('lowerPitch', 3 * after)
        clavicles(5 * e)
        if (age >= 0.6 && age < 3.2)
          reach('cover-mouth', sideOf(s))
        break
      }
      case 'look-around': {
        // Natural times the glances; architecture 4e act 4 sizes them: 35 deg aside and 20 deg up at Natural's largest
        // glance, held as sustained goals so the 3e gaze model turns the head and, past 25 deg, the trunk.
        if (released)
          break
        for (const glance of a.record.glances) {
          if (age >= glance.at && age < glance.at + glance.hold + 0.1)
            plan.gaze = { yaw: a.viewerYaw + LOOK.yaw * glance.x, pitch: a.gaze.pitch - LOOK.pitch * glance.y, kind: 'sustained' }
        }
        break
      }
      case 'check-in': {
        // Main's check-in tilt (head pitch 0.06, roll 0.2; body roll 0.15) at the MMD units; Natural's glance at the
        // user already brings the free gaze goal to the camera.
        const e = trapezoid(age, 0.5, D - 1.3, 0.8)
        naturalHead(0, 0.06 * e, s * 0.2 * e)
        trunkRoll(-NATURAL.body * s * 0.15 * e)
        break
      }
      case 'peer': {
        // Architecture 4e act 10 (a lean, 4b, toward the side it watches): the support goes to that side and the trunk
        // leans 3 and 2 deg at the lower and mid controls; main's peer head (pitch -0.14, roll 0.1) at the MMD units.
        const e = trapezoid(age, 0.9, D - 2, 1.1)
        add('lowerRoll', 3 * s * e)
        add('lowerPitch', 3 * e)
        add('midRoll', 2 * s * e)
        add('midPitch', 2 * e)
        naturalHead(0, -0.14 * e, s * 0.1 * e)
        if (age < D - 1.1 && free(['lowerBody', 'upperBody']))
          plan.support = s
        break
      }
      case 'zone-out': {
        // Architecture 4f's rest posture for a while (torso lower +3, clavicles -2, head pitch +3) with slack elbows
        // (4c sad, -4 deg); main's zone-out head yaw 0.08 and roll 0.14, and the lift as she comes back (0.08).
        const e = trapezoid(age, 1.5, D - 2.1, 0.6)
        const back = raisedCosine((age - (D - 0.9)) / 0.9)
        add('lowerPitch', 3 * e)
        clavicles(-2 * e)
        add('leftElbow', -4 * e)
        add('rightElbow', -4 * e)
        head(NATURAL.head * s * 0.08 * e, 3 * e - NATURAL.head * 0.08 * back, -NATURAL.head * s * 0.14 * e)
        break
      }
      case 'nod-off': {
        // Natural's droops (sink u^1.5 over the drawn time, catch in 0.28 s, settle in 1.3 s) at 4f's depth: head to
        // +18 deg, 3 deg overshoot up on the catch, shared as 4b nods (head 0.7, neck 0.3, torso mid 0.12), torso lower
        // to +3 with the sink.
        let pitch = 0
        for (const droop of a.record.keys) {
          const local = age - droop.t
          const sink = droop.x
          if (local < 0 || local >= sink + 0.28 + 1.3)
            continue
          if (local < sink)
            pitch = DOZE.head * (local / sink) ** 1.5
          else if (local < sink + 0.28)
            pitch = DOZE.head + (-DOZE.overshoot - DOZE.head) * minJerk((local - sink) / 0.28)
          else
            pitch = -DOZE.overshoot * (1 - minJerk((local - sink - 0.28) / 1.3))
        }
        head(0, pitch, -NATURAL.head * s * 0.25 * 0.5 * Math.max(0, pitch) / DOZE.head, NOD.neck)
        add('midPitch', NOD.mid * pitch)
        add('lowerPitch', DOZE.lower * Math.max(0, pitch) / DOZE.head)
        break
      }
      case 'sway': {
        // Main's sway at the MMD units: the head trails the body (yaw 0.08, bob 0.05 twice a period, roll 0.2) and
        // the trunk turns and rolls 0.3 body units (3 deg) at Natural's drawn period, the roll spread over the trunk
        // as the posture's weight chain spreads it.
        const e = trapezoid(age, 1.5, D - 3, 1.5)
        const phase = 2 * Math.PI * age / a.record.period
        naturalHead(0.08 * e * Math.sin(phase - Math.PI / 2), 0.05 * e * Math.sin(2 * phase), 0.2 * e * Math.sin(phase))
        const trunk = NATURAL.body * 0.3 * e * Math.sin(phase - 0.6)
        add('lowerYaw', 0.5 * trunk)
        add('midYaw', 0.5 * trunk)
        trunkRoll(-trunk)
        break
      }
      case 'about-to-speak': {
        // Main's breath in and lifted look: head 0.12 up, body 0.28 (2.8 deg) up, taken as trunk extension at the
        // mid control, with the clavicles lifting as on 4e act 1's inhale (4 deg with 4 deg of trunk), here 2.8.
        const e = minJerk(age / 0.5)
        naturalHead(0, 0.12 * e, 0)
        add('midPitch', -NATURAL.body * 0.28 * e)
        clavicles(NATURAL.body * 0.28 * e)
        break
      }
      case 'let-go': {
        // Main's breath out and look aside (head yaw 0.22, pitch -0.16, roll 0.08; body -0.25, 2.5 deg of slump at
        // the lower control) with 4e act 1's exhale: the clavicles drop 2 deg.
        const e = trapezoid(age, 0.45, 1.2, 0.95)
        naturalHead(s * 0.22 * e, -0.16 * e, s * 0.08 * e)
        add('lowerPitch', NATURAL.body * 0.25 * e)
        clavicles(-2 * e)
        break
      }
      case 'sleep': {
        // The doze body is the rest layer's or the sleep clip's. Asleep, the gaze goal holds, so no shift moves the
        // eyes under closed lids. Waking (4f): the head overshoots its rest by 15 % of the drop, the shoulders rise
        // 4 deg for 0.4 s.
        if (!released) {
          plan.gaze = a.gaze
          plan.holdGaze = true
          break
        }
        const wake = time - (a.releaseAt ?? time)
        head(0, path(wake, [[0.6 * a.releaseSeconds, -WAKE.overshoot], [a.releaseSeconds, 0]]) * DOZE.head, 0, NOD.neck)
        clavicles(path(wake, [[0.15, WAKE.clavicle], [WAKE.clavicleSeconds, WAKE.clavicle], [WAKE.clavicleSeconds + 0.3, 0]]))
        break
      }
      // The whole-body kinds (A4) take their sizes and timing from the 3D motion architecture's act table (4e, the
      // row named in each case). A form that does not fit the record's duration is compressed so that it ends by it.
      case 'sigh': {
        // 4e act 1: inhale 1.0 s (torso mid -4, clavicles +4, head -3), hold 0.3 s, exhale 1.6 s (torso lower +3,
        // clavicles -2 with overshoot), then recover.
        const k = Math.min(1, (D - 0.4) / 2.9)
        add('midPitch', path(age, [[1.0 * k, -4], [1.3 * k, -4], [2.9 * k, 0]]))
        add('lowerPitch', path(age, [[1.3 * k, 0], [2.9 * k, 3], [D, 0]]))
        clavicles(path(age, [[1.0 * k, 4], [1.3 * k, 4], [2.4 * k, -2], [2.9 * k, -1], [D, 0]]))
        head(0, path(age, [[1.0 * k, -3], [1.3 * k, -3], [2.9 * k, 1], [D, 0]]), 0)
        break
      }
      case 'shoulder-roll': {
        // 4e act 2: the clavicles circle once (up 10, back 8, down 3) over 1.4 s, the two sides 120 ms apart; the head
        // rolls 12 deg to one side, holds 0.6 s and returns; a second roll goes to the other side.
        const cycle = D / a.record.count
        const index = Math.min(a.record.count - 1, Math.floor(age / cycle))
        const local = age - index * cycle
        const side = index % 2 === 0 ? s : -s
        for (const arm of SIDES) {
          const t = local - (arm === sideOf(side) ? 0 : 0.12)
          channels[ARM_START[arm]] += w * path(t, [[0.35, 10], [0.7, 5], [1.05, -3], [1.4, 0]]) * DEG
          channels[ARM_START[arm] + 1] += w * path(t, [[0.35, 0], [0.7, -8], [1.05, -3], [1.4, 0]]) * DEG
        }
        head(0, 0, side * path(local, [[0.5, 12], [1.1, 12], [cycle, 0]]))
        break
      }
      case 'shift-stance': {
        // 4e act 3: the support goes fully to one side, then returns to a half shift. The free foot's in-place step is
        // not performed (no foot-step output for an act), so it does not read; Natural weighs it 0 and only `play` starts it.
        if (free(['lowerBody', 'upperBody']))
          plan.support = age < D - 0.3 ? s : 0.5 * s
        break
      }
      case 'clasp-hands': {
        // 4e act 6: both hands meet low, one lets go first, the pelvis rocks 0.012 L at 0.35 Hz meanwhile. Joint
        // targets fitted on two rigs pose it (no solved contact anchor; the behind target has no source), the hands
        // stay apart on the mesh, and Natural weighs it 0.
        const behind = a.record.variant === 1
        const target = behind ? { flex: -25, abduct: 15, twist: 0, elbow: 50 } : { flex: -1.3, abduct: 0.5, twist: 20.7, elbow: 82.2 }
        for (const arm of SIDES) {
          const start = ARM_START[arm]
          // 4e sets no reach time. At 0.8 s the elbows changed speed by up to 0.32 deg per tick within a tick; at 1.2 s by
          // 0.25 (Chisa) and 0.23 (Ellen), inside the act test's bound but at its edge (E/g4/a/scratch/form-measure.ts).
          const e = trapezoid(age, 1.2, D - 2.2 - (arm === sideOf(s) ? 0.25 : 0), 1.0)
          add(BODY_CHANNELS[start + 2], e * (target.flex - context.rest[start + 2] / DEG))
          add(BODY_CHANNELS[start + 3], e * (target.abduct - context.rest[start + 3] / DEG))
          add(BODY_CHANNELS[start + 4], e * (target.twist - context.rest[start + 4] / DEG))
          add(BODY_CHANNELS[start + 5], e * (target.elbow - context.rest[start + 5] / DEG))
        }
        const held = trapezoid(age, 1.2, D - 2.2, 1.0)
        channels[c('pelvisZ')] += w * 0.012 * held * Math.sin(2 * Math.PI * 0.35 * Math.max(0, age - 1.2))
        break
      }
      case 'hair-touch': {
        // 4e act 8: the hand on the side rises to the temple (the held `hair-touch` form) and returns; the head tilts
        // 4 deg toward it. The 0.10 A sweep back is not performed: a held form has no path after it lands.
        if (age >= 0.1 && age < D - 0.9)
          reach('hair-touch', sideOf(s))
        head(0, 0, 4 * s * trapezoid(age, 0.6, D - 1.5, 0.9))
        break
      }
      case 'heel-rock': {
        // 4e act 11: two or three raises, pelvis up 0.012 L, 0.45 s up and down each, clavicles +2 at each top. Without
        // the feet's 14 deg toe-down pitch it does not read; Natural weighs it 0 and only `play` starts it.
        const period = Math.min(0.9, D / a.record.count)
        const index = Math.min(a.record.count - 1, Math.floor(age / period))
        const bump = raisedCosine((age - index * period) / period)
        channels[c('pelvisY')] += w * 0.012 * bump
        clavicles(2 * bump)
        break
      }
      case 'arm-swing': {
        // 4e act 7: an 8 deg push into each arm pendulum, opposite signs, two or three times at the pendulum's own
        // period: the relaxed upper-arm follower's at her tension when the swing began (3f, `armResponse`), as many as
        // fit the behaviour. No finger flick at the forward peaks.
        const period = 1 / armResponse(2, 0, a.tension)[0]
        const pushes = Math.max(1, Math.min(a.record.count, Math.floor(D / period)))
        const u = age < pushes * period ? (age % period) / period : 0
        const swing = 8 * Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u)
        add('leftFlex', swing)
        add('rightFlex', -swing)
        break
      }
    }
    // A clip that owns a group takes it whole; the act gives it up the way the cue layer does.
    for (let channel = 0; channel < channels.length; channel++)
      channels[channel] *= Math.max(0, Math.min(1, 1 - 2 * input.owned[channelGroup(BODY_CHANNELS[channel])]))
  }

  return {
    id: 'act',
    order: 'act',
    mode: 'additive',
    mask: new Float64Array(BODY_CHANNELS.length).fill(1),
    // Every form starts and ends at zero with zero slope, so the stack adds no ramp.
    enterSeconds: 0,
    exitSeconds: 0,
    plan(context) {
      update(context)
      return plan
    },
    step(context) {
      update(context)
      output.weight = act ? 1 : 0
      output.sequence = act?.record.seq ?? 0
      return output
    },
    reset() {
      act = null
      playedSeq = null
      arms = null
      tick = -1
      plan = {}
      channels.fill(0)
      output.modulation = undefined
    },
  }
}
