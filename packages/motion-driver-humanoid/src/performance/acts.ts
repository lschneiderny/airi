import type { BodyChannel, BodySide } from './channels'
import type { BodyArmForm, BodyGazeGoal, BodyIdleAct, BodyIdleKind } from './contracts'
import type { LayerOutput, PerformanceContext, PerformanceLayer, PerformancePlan } from './stack'

import { minJerk } from '../dynamics'
import { ARM_START, BODY_CHANNELS, channelGroup, channelIndex, DEG, SIDES } from './channels'
import { path } from './cues'

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

/** One behaviour the layer plays; times are performer seconds. */
interface Act {
  readonly record: BodyIdleAct
  readonly start: number
  releaseAt: number | null
  releaseSeconds: number
  /** The gaze goal and the viewer when it started: a look-around aims around the viewer, sleep holds the goal. */
  readonly gaze: BodyGazeGoal
  readonly viewerYaw: number
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
        // extends the limbs and the trunk, often with a yawn. Timing is Natural's (rise 1.3 s, hold 1.6 s, fall 1.1 s,
        // then a settle a little lower). The trunk extends to half of each control's extension limit (6.4), the arms
        // rise to 120 deg of flexion, the soft limit's identity edge (3g: 80 % of the 150 deg limit), 20 deg out and
        // nearly straight, and the clavicles lift half of the 4b shrug peak (14 deg).
        const e = trapezoid(age, 1.3, 1.6, 1.1)
        const settle = raisedCosine((age - 3.5) / 1.7)
        // The arms go up and come down out to the side, through the corrector's guard abduction (6.2: 45 deg, clear on
        // every rig), not past the front of the chest, and glide back in over the settle. Let go early, they come down
        // over the fall and settle (1.6 s), out to the side within its first third.
        const aside = released ? path(Math.min(1, (time - (a.releaseAt ?? time)) / a.releaseSeconds), [[0.35, 1], [1, 0]]) : 0
        add('lowerPitch', -6 * e)
        add('midPitch', -5 * e + NATURAL.body * 0.2 * settle)
        add('upperPitch', -3 * e)
        naturalHead(s * 0.1 * e, 0.45 * e - 0.14 * settle, s * 0.3 * e)
        clavicles(7 * e)
        for (const side of SIDES) {
          const start = ARM_START[side]
          add(BODY_CHANNELS[start + 2], e * (120 - context.rest[start + 2] / DEG))
          const rest = context.rest[start + 3] / DEG
          const abduct = path(age, [[0.65, 45 - rest], [1.3, 20 - rest], [2.9, 20 - rest], [3.6, 45 - rest], [D, 0]])
          channels[start + 3] += (w * abduct + (1 - walking) * aside * (45 - rest - abduct)) * DEG
          add(BODY_CHANNELS[start + 5], e * (10 - context.rest[start + 5] / DEG))
        }
        break
      }
      case 'yawn': {
        // Architecture 4e act 9: head pitch -8, torso mid -3, clavicles +5 over the opening, then an exhale and slump
        // (4f rest's torso lower +3); the hand covers the mouth (`cover-mouth`) while it is open. Timing is Natural's
        // (open 1.4 s, hold 1.1 s, close 1.1 s, heavy lids after), which matches Provine 1986 (Ethology 72(2):109-122):
        // a yawn lasts about 6 s.
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
        // Natural's droops (each sinks u^1.5 over its drawn time, catches in 0.28 s, settles in 1.3 s) at architecture
        // 4f's depth: the head to +18 deg, a 3 deg overshoot up on the catch; head and neck and the trunk share as 4b
        // nods (head 0.7, neck 0.3, torso mid 0.12), the torso lower to +3 with the sink (4f).
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
        // The doze body is the rest layer's (`directive.rest`) or the sleep clip's. While she sleeps her gaze holds
        // still: the goal stays where it was when she fell asleep, so no gaze shift moves the eyes under closed lids.
        // Waking (architecture 4f): the head lifts past where it rests by 15 % of the doze's drop before it settles,
        // and the shoulders rise 4 deg for 0.4 s.
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
      tick = -1
      plan = {}
      channels.fill(0)
      output.modulation = undefined
    },
  }
}
