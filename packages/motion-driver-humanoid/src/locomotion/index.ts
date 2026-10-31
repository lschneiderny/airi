import type { Foot, FootAnchor, TurnStep } from '../foot-contact'
import type { LocomotionPace, RigTraits, Vec3 } from '../types'
import type { NaturalBodyComposition } from '../weight-shift'

import { planFootSteps } from '../foot-contact'
import { createRandomStream } from '../random'

export interface GaitTraits extends Pick<RigTraits, 'legLength' | 'footBaselineY'> {
  /** Bind hip-to-ankle vertical distance in model units. */
  readonly hipToAnkleY: number
  /** Bind ankle positions in mesh-local model units; each hip sits hipToAnkleY above its ankle. */
  readonly bindAnkles: Record<Foot, Vec3>
}

export interface LocomotionInput {
  /** Seconds on the fixed 120 Hz grid; only stamps events. */
  readonly now: number
  /** World x on the ground line; null means stay. */
  readonly goalX: number | null
  readonly pace: LocomotionPace
  /** Facing at arrival, in radians; 0 faces the camera. */
  readonly arriveFacing: number
  /** False while sitting, during one-shots, or when a clip owns root or leg IK. */
  readonly enabled: boolean
  /** WeightShiftOutput.s; picks the first swing foot. */
  readonly idleSupport: number
  /** Current planted anchors in world space; the gait seeds from them when it leaves idle. */
  readonly plantedFeet: Record<Foot, FootAnchor>
}

export interface LocomotionFoot {
  /** World target for the ankle. */
  readonly target: FootAnchor
  /** True while this foot carries weight; its target is then frozen. */
  readonly planted: boolean
  /** Swing progress 0..1, or null while planted. */
  readonly swing: number | null
}

export interface GaitEvent {
  readonly kind: 'liftOff' | 'heelStrike'
  readonly foot: Foot
  readonly time: number
}

export interface LocomotionFrame {
  readonly mode: 'idle' | 'turning' | 'starting' | 'walking' | 'stopping'
  readonly root: {
    /** World position; y = 0. */
    readonly position: Vec3
    readonly yaw: number
  }
  readonly speed: number
  /** Continuous phase, in steps. */
  readonly phase: number
  readonly feet: Record<Foot, LocomotionFoot>
  /** Same sign as WeightShiftOutput.s. */
  readonly support: number
  readonly body: NaturalBodyComposition & { readonly chestCounterYaw: number }
  readonly armSwing: Record<Foot, {
    readonly flexion: number
    readonly elbowFlex: number
  }>
  /** Blend factor; weight-shift duck is 1 - weight. */
  readonly weight: number
  readonly events: readonly GaitEvent[]
}

const radians = Math.PI / 180
const epsilon = 1e-9
const referenceRate = 1.8
const minRate = 1.2
const maxRate = 2.4
const referenceLengthShare = 0.5
/** beta: share of a stride that a foot carries weight. */
const stanceShare = 0.6
/** delta = 2 beta - 1: double-support share of each step. */
const doubleSupport = 2 * stanceShare - 1
/** Landing targets follow the predicted root until this swing progress, then freeze. */
const replanUntil = 0.75
const planReach = 0.97
const hardReach = 0.985
const kneeSoftening = 0.02
/**
 * How far the reach floor may lower the pelvis below the bob: enough for the off-centre
 * stances of starts and stops. A misplaced foot needs more, so the leash shortens root travel.
 */
const floorMarginShare = 0.01
/** Share of a swing over which a lifted foot's reach requirement fades out. */
const liftFadeShare = 0.25
/** Floor of the walking swing height; 0.03 L lets short closing steps slide more than 0.002 L. */
const swingHeightFloorShare = 0.04
const stepWidthShare = 0.7
const swayShare = 0.03
/** Goals closer than this share of the leg length are not worth a walk. */
const minWalkShare = 0.05
/** After arrival each foot must sit within this fore-aft share of the root, or it takes a closing step. */
const closingShare = 0.02
const turnStepYaw = 45 * radians
const turnStepDuration = 0.45
const turnTolerance = radians
const turnSwingShare = 0.03
const settleDuration = 0.25
const blendDuration = 0.3
const leanOmega = 4
const paceSpeeds: Record<LocomotionPace, number> = { stroll: 0.6, walk: 1 }
const sides = ['left', 'right'] as const
/** Lateral sign: left = -1, right = +1, matching weight-shift. */
const footSign: Record<Foot, 1 | -1> = { left: -1, right: 1 }

function finite(value: number) {
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function wrap(value: number) {
  return Math.atan2(Math.sin(value), Math.cos(value))
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value)
}

function opposite(foot: Foot): Foot {
  return foot === 'left' ? 'right' : 'left'
}

function copyAnchor(anchor: FootAnchor): FootAnchor {
  return { position: { ...anchor.position }, yaw: anchor.yaw }
}

/** Cycloid blend: zero velocity at lift-off and touchdown. */
function cycloid(progress: number) {
  return progress - Math.sin(2 * Math.PI * progress) / (2 * Math.PI)
}

interface Spring {
  value: number
  velocity: number
}

/** Exact critically damped response to a target held constant over dt. */
function advanceSpring(spring: Spring, target: number, omega: number, dt: number) {
  const offset = spring.value - target
  const impulse = spring.velocity + omega * offset
  const decay = Math.exp(-omega * dt)
  spring.value = target + (offset + impulse * dt) * decay
  spring.velocity = (spring.velocity - omega * impulse * dt) * decay
}

interface Swing {
  readonly foot: Foot
  readonly lift: FootAnchor
  /** Bob amplitude at lift-off; the amplitude blends to its target over the swing. */
  readonly bobFrom: number
  /** Reach-floor drop this foot required at lift-off; it fades out over the swing. */
  readonly liftDrop: number
  land: FootAnchor
  /** Planned fore-aft offset of the landing ahead of the root. */
  reach: number
  height: number
  progress: number
}

interface Walk {
  readonly direction: 1 | -1
  readonly heading: number
  readonly firstFoot: Foot
  /** Index of the current step, floor(phase). */
  step: number
  starting: boolean
  arrived: boolean
  settle: { readonly phase: number, elapsed: number } | null
}

interface Turn {
  readonly steps: ReturnType<typeof planFootSteps>
  /** Facing at the start of each step, followed by the final facing. */
  readonly facings: readonly number[]
  index: number
  elapsed: number
  /** Reach-floor drop the stepping foot required when its step started. */
  liftDrop: number
}

/**
 * Owns the root position, gait phase and world foot anchors for one character.
 * Time comes only from step's dt; the seeded stream only breaks first-foot ties.
 */
class Locomotion {
  private readonly random: () => number
  private readonly referenceLength: number
  private readonly referenceSpeed: number
  private readonly maxAcceleration: number
  private readonly halfStepWidth: number
  /** Largest hip-to-ankle sideways offset during double support. */
  private readonly lateralError: number
  private x = 0
  private readonly z = 0
  private yaw = 0
  private speed = 0
  private phase = 0.1
  /** Lateral sign of the first swing foot of the current walk. */
  private leadSign: 1 | -1 = -1
  private feet: Record<Foot, FootAnchor>
  /** Fore-aft half-span each planted foot was placed for; it lifts about this far behind the hip. */
  private spans: Record<Foot, number> = { left: 0, right: 0 }
  private bob: number
  private swing: Swing | null = null
  private walk: Walk | null = null
  private turn: Turn | null = null
  private lastTurnFoot: Foot | null = null
  private mode: LocomotionFrame['mode'] = 'idle'
  private rebased = false
  private blend = 0
  private readonly lean: Spring = { value: 0, velocity: 0 }
  /** This tick's pelvis, shared by the leash and the frame so both see the same drop. */
  private posture: ReturnType<Locomotion['pelvis']> | null = null
  private clamps = 0

  constructor(private readonly traits: GaitTraits, seed: number) {
    this.random = createRandomStream(seed)
    this.referenceLength = referenceLengthShare * traits.legLength
    this.referenceSpeed = this.referenceLength * referenceRate
    this.maxAcceleration = this.referenceSpeed
    const { left, right } = traits.bindAnkles
    const ankleSpacing = Math.hypot(left.x - right.x, left.z - right.z)
    this.halfStepWidth = stepWidthShare * ankleSpacing / 2
    this.lateralError = Math.abs(ankleSpacing / 2 - this.halfStepWidth) + swayShare * traits.legLength * Math.sin(Math.PI * doubleSupport / 2)
    this.feet = this.bindFeet()
    this.bob = this.bobAmplitude(0)
  }

  /** Ticks on which the reach leash shortened root travel. Zero in normal driving. */
  get leashClamps() {
    return this.clamps
  }

  /** Teleports the root, re-plants both feet at the bind ankle offsets and returns to idle. */
  rebase({ x, yaw }: { x: number, yaw: number }) {
    this.x = finite(x)
    this.yaw = finite(yaw)
    this.speed = 0
    this.phase = 0.1
    this.swing = null
    this.walk = null
    this.turn = null
    this.lastTurnFoot = null
    this.feet = this.bindFeet()
    this.spans = { left: 0, right: 0 }
    this.bob = this.bobAmplitude(0)
    this.mode = 'idle'
    this.rebased = true
    this.blend = 0
    this.lean.value = 0
    this.lean.velocity = 0
  }

  step(input: LocomotionInput, dt: number): LocomotionFrame {
    dt = Math.max(0, finite(dt))
    const events: GaitEvent[] = []
    const previousSpeed = this.speed
    let mode: LocomotionFrame['mode'] = 'idle'
    if (!input.enabled) {
      this.halt()
    }
    else if (!this.rebased && dt > 0) {
      if (!this.walk && !this.turn)
        this.depart(input)
      if (this.turn)
        mode = this.advanceTurn(input.now, dt, events)
      else if (this.walk)
        mode = this.advanceWalk(input, dt, events)
    }
    this.rebased = false
    this.mode = mode
    if (mode === 'idle')
      this.lastTurnFoot = null

    const owned = mode === 'turning' || (this.walk !== null && this.walk.settle === null)
    this.blend = clamp(this.blend + (owned ? dt : -dt) / blendDuration, 0, 1)
    const acceleration = dt > 0 ? (this.speed - previousSpeed) / dt : 0
    const leanTarget = 2 * radians * this.speed / this.referenceSpeed + 3 * radians * acceleration / this.maxAcceleration
    advanceSpring(this.lean, leanTarget, leanOmega, dt)
    const frame = this.frame(mode, events, this.posture ?? this.pelvis(this.speed, this.x))
    this.posture = null
    return frame
  }

  private bindFeet(): Record<Foot, FootAnchor> {
    const place = (bind: Vec3): FootAnchor => {
      const local = this.toWorld(bind.x, bind.z)
      return { position: { x: local.x, y: this.traits.footBaselineY, z: local.z }, yaw: this.yaw }
    }
    return { left: place(this.traits.bindAnkles.left), right: place(this.traits.bindAnkles.right) }
  }

  /** Mesh-local x (character left) and z (forward) to world, about the root at the current yaw. */
  private toWorld(localX: number, localZ: number) {
    const cos = Math.cos(this.yaw)
    const sin = Math.sin(this.yaw)
    return { x: this.x + cos * localX + sin * localZ, z: this.z - sin * localX + cos * localZ }
  }

  private foreAft(point: Vec3) {
    return (point.x - this.x) * Math.sin(this.yaw) + (point.z - this.z) * Math.cos(this.yaw)
  }

  private stepRate(speed: number) {
    return clamp(Math.sqrt(speed * this.referenceSpeed) / this.referenceLength, minRate, maxRate)
  }

  /**
   * Largest speed that still stops exactly at the goal on this tick grid while the
   * speed changes by at most a_max * dt per tick: the discrete form of sqrt(2 a_max d).
   */
  private stoppingSpeed(distance: number, dt: number) {
    const change = this.maxAcceleration * dt
    const units = distance / (change * dt)
    const whole = Math.floor((Math.sqrt(1 + 8 * units) - 1) / 2)
    const fraction = clamp((units - whole * (whole + 1) / 2) / (whole + 1), 0, 1)
    return (whole + fraction) * change
  }

  /**
   * Root travel during the stance that follows a landing in `untilLanding` seconds, predicted
   * by running advanceWalk's per-tick speed law forward. `ahead` is null while braking.
   */
  private predictStanceTravel(ahead: number | null, command: number, untilLanding: number, dt: number) {
    const change = this.maxAcceleration * dt
    const travels = [0]
    const speeds = [this.speed]
    let speed = this.speed
    let travelled = 0
    const extend = (until: number) => {
      while ((travels.length - 1) * dt < until) {
        const remaining = ahead === null ? 0 : ahead - travelled
        const target = ahead === null || remaining <= 0 ? 0 : Math.min(command, this.stoppingSpeed(remaining, dt))
        speed = Math.max(0, clamp(target, speed - change, speed + change))
        travelled += ahead === null ? speed * dt : Math.min(speed * dt, Math.max(0, remaining))
        travels.push(travelled)
        speeds.push(speed)
      }
    }
    // Linear interpolation between ticks keeps the prediction continuous as the landing time slides.
    const sample = (values: readonly number[], time: number) => {
      const index = Math.min(Math.floor(time / dt), values.length - 2)
      const from = values[index] ?? 0
      return from + ((values[index + 1] ?? from) - from) * (time / dt - index)
    }
    extend(untilLanding + dt)
    const stanceDuration = 2 * stanceShare / this.stepRate(sample(speeds, untilLanding))
    extend(untilLanding + stanceDuration + dt)
    return sample(travels, untilLanding + stanceDuration) - sample(travels, untilLanding)
  }

  /**
   * A_bob = (h0 - c0 - sqrt(r_plan^2 - span^2 - e_lat^2)) / ((1 + cos(pi delta)) / 2), where span is
   * the fore-aft hip-to-ankle offset at heel strike and lift-off (beta * l at constant speed).
   */
  private bobAmplitude(halfSpan: number) {
    const reach = planReach * this.traits.legLength
    const horizontal = halfSpan ** 2 + this.lateralError ** 2
    const required = this.traits.hipToAnkleY - kneeSoftening * this.traits.legLength - Math.sqrt(Math.max(0, reach ** 2 - horizontal))
    return Math.max(0, required / ((1 + Math.cos(Math.PI * doubleSupport)) / 2))
  }

  private support(phase: number) {
    return -this.leadSign * Math.sin(Math.PI * (phase - 0.1))
  }

  /** +1 while the right foot leads, -1 while the left foot leads. */
  private lead(phase: number) {
    return -this.leadSign * Math.cos(Math.PI * (phase - 0.1))
  }

  private pelvis(speed: number, rootX: number) {
    const length = speed / this.stepRate(speed)
    const swayScale = 1 - 0.3 * clamp((speed - this.referenceSpeed) / (0.3 * this.referenceSpeed), 0, 1)
    const lateral = swayShare * this.traits.legLength * swayScale * this.support(this.phase)
    const bobDrop = kneeSoftening * this.traits.legLength + this.bob * (1 + Math.cos(2 * Math.PI * (this.phase - 0.1))) / 2
    const required = Math.min(bobDrop + floorMarginShare * this.traits.legLength, this.requiredDrop(rootX, lateral))
    return { length, lateral, drop: Math.max(bobDrop, required) }
  }

  /**
   * Smallest drop that keeps every planted foot within r_plan of its hip. The bob covers
   * centred stances and landings; this floor covers stances that are off-centre at
   * mid-stance, such as while stopping. A lifted foot's requirement is frozen at lift-off
   * and fades out early in the swing, so the floor never jumps.
   */
  private requiredDrop(rootX: number, lateral: number) {
    const turnStep = this.turn && this.turn.elapsed > 0 ? this.turn.steps[this.turn.index] : undefined
    const fade = (progress: number) => 1 - cycloid(Math.min(1, progress / liftFadeShare))
    let required = 0
    for (const side of sides) {
      if (this.swing?.foot === side)
        required = Math.max(required, fade(this.swing.progress) * this.swing.liftDrop)
      else if (this.turn && turnStep?.foot === side)
        required = Math.max(required, fade(this.turn.elapsed / turnStep.duration) * this.turn.liftDrop)
      else
        required = Math.max(required, this.anchorDrop(side, this.feet[side].position, rootX, lateral))
    }
    return required
  }

  private anchorDrop(side: Foot, anchor: Vec3, rootX: number, lateral: number) {
    const bind = this.traits.bindAnkles[side]
    const cos = Math.cos(this.yaw)
    const sin = Math.sin(this.yaw)
    const hipX = rootX + cos * bind.x + sin * bind.z - cos * lateral
    const hipZ = this.z - sin * bind.x + cos * bind.z + sin * lateral
    const horizontal = (hipX - anchor.x) ** 2 + (hipZ - anchor.z) ** 2
    const reach = planReach * this.traits.legLength
    return bind.y + this.traits.hipToAnkleY - anchor.y - Math.sqrt(Math.max(0, reach ** 2 - horizontal))
  }

  private depart(input: LocomotionInput) {
    const goal = input.goalX
    if (goal === null || !Number.isFinite(goal))
      return
    const walkTo = Math.abs(goal - this.x) > minWalkShare * this.traits.legLength
    const direction = goal > this.x ? 1 : -1
    const facing = walkTo ? direction * Math.PI / 2 : finite(input.arriveFacing)
    const turns = Math.abs(wrap(facing - this.yaw)) > turnTolerance
    if (!walkTo && !turns)
      return
    // Leaving idle: the foot-contact planner owned the feet until now.
    if (this.mode === 'idle') {
      this.feet = { left: copyAnchor(input.plantedFeet.left), right: copyAnchor(input.plantedFeet.right) }
      this.spans = { left: 0, right: 0 }
      this.phase = 0.1
    }
    if (turns)
      this.startTurn(facing)
    else
      this.startWalk(direction, facing, input.idleSupport)
  }

  private startTurn(facing: number) {
    const delta = wrap(facing - this.yaw)
    const count = Math.max(2, Math.ceil(Math.abs(delta) / turnStepYaw - epsilon))
    const facings = Array.from({ length: count + 1 }, (_, index) => this.yaw + delta * index / count)
    const footYaws = { left: this.feet.left.yaw, right: this.feet.right.yaw }
    let foot: Foot = delta > 0 ? 'left' : 'right'
    const commands: TurnStep[] = []
    for (let index = 1; index <= count; index++) {
      // Each foot lands at the facing one step ahead, so 90 degrees takes two steps
      // and both feet finish aligned with the final facing.
      const landingYaw = this.yaw + delta * Math.min(index + 1, count) / count
      const yawDelta = wrap(landingYaw - footYaws[foot])
      commands.push({ foot, yawDelta, duration: turnStepDuration })
      footYaws[foot] += yawDelta
      foot = opposite(foot)
    }
    const pivot = { x: this.x, y: 0, z: this.z }
    this.turn = {
      steps: planFootSteps(commands, this.feet, pivot, turnSwingShare * this.traits.legLength),
      facings,
      index: 0,
      elapsed: 0,
      liftDrop: 0,
    }
  }

  private advanceTurn(now: number, dt: number, events: GaitEvent[]): LocomotionFrame['mode'] {
    const turn = this.turn
    const step = turn?.steps[turn.index]
    const from = turn?.facings[turn.index]
    const to = turn?.facings[turn.index + 1]
    if (!turn || !step || from === undefined || to === undefined) {
      this.turn = null
      return 'turning'
    }
    if (turn.elapsed === 0) {
      // Turning stands centred (support 0), so the pelvis has no lateral offset.
      turn.liftDrop = this.anchorDrop(step.foot, this.feet[step.foot].position, this.x, 0)
      events.push({ kind: 'liftOff', foot: step.foot, time: now })
    }
    turn.elapsed = Math.min(step.duration, turn.elapsed + dt)
    this.yaw = from + (to - from) * turn.elapsed / step.duration
    if (turn.elapsed >= step.duration - epsilon) {
      this.feet[step.foot] = step.sample(step.duration)
      this.spans[step.foot] = 0
      events.push({ kind: 'heelStrike', foot: step.foot, time: now })
      this.yaw = to
      turn.index++
      turn.elapsed = 0
      if (turn.index === turn.steps.length) {
        this.lastTurnFoot = step.foot
        this.turn = null
      }
    }
    return 'turning'
  }

  private startWalk(direction: 1 | -1, heading: number, idleSupport: number) {
    let firstFoot: Foot
    if (this.lastTurnFoot)
      firstFoot = opposite(this.lastTurnFoot)
    // Weight on the right (s > 0.2) leaves the left foot unloaded and free to swing.
    else if (idleSupport > 0.2)
      firstFoot = 'left'
    else if (idleSupport < -0.2)
      firstFoot = 'right'
    else
      firstFoot = this.random() < 0.5 ? 'left' : 'right'
    this.lastTurnFoot = null
    this.leadSign = footSign[firstFoot]
    this.phase = 0.1
    this.speed = 0
    this.walk = { direction, heading, firstFoot, step: 0, starting: true, arrived: false, settle: null }
  }

  private advanceWalk(input: LocomotionInput, dt: number, events: GaitEvent[]): LocomotionFrame['mode'] {
    const walk = this.walk
    if (!walk)
      return 'idle'
    const command = paceSpeeds[input.pace] * this.referenceSpeed
    const goal = input.goalX !== null && Number.isFinite(input.goalX) ? input.goalX : null
    const ahead = goal === null ? 0 : (goal - this.x) * walk.direction
    // Without a goal ahead, brake as hard as allowed and stop wherever that lands.
    const braking = goal === null || ahead <= 0
    const profiled = !braking && this.stoppingSpeed(ahead, dt) < command
    const target = braking || walk.settle ? 0 : Math.min(command, this.stoppingSpeed(ahead, dt))
    const change = this.maxAcceleration * dt
    const speed = Math.max(0, clamp(target, this.speed - change, this.speed + change))

    const rate = this.stepRate(speed)
    if (walk.settle) {
      walk.settle.elapsed += dt
      this.phase = Math.min(walk.settle.phase, this.phase + rate * dt)
    }
    else {
      this.phase += rate * dt
    }

    let advance = braking ? speed * dt : Math.min(speed * dt, ahead)
    this.posture = this.pelvis(speed, this.x + walk.direction * advance)
    advance = this.leash(advance, walk.direction, this.posture)
    this.x += walk.direction * advance
    if (goal !== null && !braking && ahead - advance <= epsilon)
      this.x = goal
    this.speed = advance / dt
    walk.arrived = this.speed === 0 && target === 0

    this.advanceFeet(walk, goal, braking, command, dt, input.now, events)

    if (walk.arrived && !this.swing && !walk.settle) {
      const closed = sides.every(side => Math.abs(this.foreAft(this.feet[side].position)) < closingShare * this.traits.legLength)
      if (closed)
        walk.settle = { phase: Math.max(this.phase, walk.step + 0.1), elapsed: 0 }
    }
    if (walk.settle && walk.settle.elapsed >= settleDuration - epsilon) {
      this.walk = null
      return 'stopping'
    }
    if (walk.settle || walk.arrived || braking || profiled)
      return 'stopping'
    if (walk.starting && this.speed < command - epsilon)
      return 'starting'
    walk.starting = false
    return 'walking'
  }

  /** Shortens root travel so no planted ankle ends farther than r_hard from its hip. */
  private leash(advance: number, direction: 1 | -1, pelvis: { lateral: number, drop: number }) {
    const hardLimit = hardReach * this.traits.legLength
    let limit = advance
    for (const side of sides) {
      if (this.swing?.foot === side)
        continue
      const bind = this.traits.bindAnkles[side]
      const hip = this.toWorld(bind.x, bind.z)
      const anchor = this.feet[side].position
      const dx = hip.x - Math.cos(this.yaw) * pelvis.lateral - anchor.x
      const dy = bind.y + this.traits.hipToAnkleY - pelvis.drop - anchor.y
      const dz = hip.z + Math.sin(this.yaw) * pelvis.lateral - anchor.z
      // Solve |hip + s * direction * x - anchor| <= r_hard for the largest advance s.
      const b = dx * direction
      const c = dx ** 2 + dy ** 2 + dz ** 2 - hardLimit ** 2
      const discriminant = b * b - c
      limit = Math.min(limit, discriminant < 0 ? 0 : Math.max(0, -b + Math.sqrt(discriminant)))
    }
    if (limit < advance - 1e-12)
      this.clamps++
    return limit
  }

  private advanceFeet(walk: Walk, goal: number | null, braking: boolean, command: number, dt: number, now: number, events: GaitEvent[]) {
    const index = Math.floor(this.phase)
    if (index > walk.step) {
      if (this.swing) {
        this.feet[this.swing.foot] = copyAnchor(this.swing.land)
        this.spans[this.swing.foot] = this.swing.reach
        events.push({ kind: 'heelStrike', foot: this.swing.foot, time: now })
        this.swing = null
      }
      walk.step = index
    }
    const t = this.phase - walk.step
    if (walk.settle || t < doubleSupport)
      return
    const foot = walk.step % 2 === 0 ? walk.firstFoot : opposite(walk.firstFoot)
    const progress = (t - doubleSupport) / (1 - doubleSupport)
    const rate = this.stepRate(this.speed)
    if (!this.swing) {
      const lift = copyAnchor(this.feet[foot])
      const liftDrop = this.anchorDrop(foot, lift.position, this.x, this.posture?.lateral ?? 0)
      this.swing = { foot, lift, bobFrom: this.bob, liftDrop, progress, ...this.planLanding(walk, foot, lift, t, rate, goal, braking, command, dt) }
      events.push({ kind: 'liftOff', foot, time: now })
    }
    else if (progress < replanUntil) {
      Object.assign(this.swing, this.planLanding(walk, foot, this.swing.lift, t, rate, goal, braking, command, dt))
    }
    this.swing.progress = progress
    // The drop must cover every foot in contact: the stance foot until it lifts and the landing foot.
    const span = Math.max(stanceShare * this.speed / rate, this.spans[opposite(foot)], this.swing.reach)
    this.bob = this.swing.bobFrom + (this.bobAmplitude(span) - this.swing.bobFrom) * cycloid(progress)
  }

  /**
   * X_land = R(t_land) + (D / 2) * d + sign * (w / 2) * n. R(t_land) extrapolates the current
   * speed, capped at the goal or the braking distance. D is the root travel predicted over the coming stance (2 beta
   * steps), so the foot lifts as far behind the hip as it landed ahead. At constant speed
   * D / 2 = beta * l; D reaches 0 once the root stops first, which lands the foot beside it.
   */
  private planLanding(walk: Walk, foot: Foot, lift: FootAnchor, t: number, rate: number, goal: number | null, braking: boolean, command: number, dt: number) {
    const untilLanding = (1 - t) / rate
    const ahead = braking || goal === null ? null : Math.max(0, (goal - this.x) * walk.direction)
    const travel = this.speed * untilLanding
    const room = ahead ?? this.speed ** 2 / (2 * this.maxAcceleration)
    const rootX = this.x + walk.direction * Math.min(travel, room)
    const reach = this.predictStanceTravel(ahead, command, untilLanding, dt) / 2
    const lateral = footSign[foot] * this.halfStepWidth
    const land: FootAnchor = {
      position: {
        x: rootX + Math.sin(walk.heading) * reach - Math.cos(walk.heading) * lateral,
        y: this.traits.footBaselineY,
        z: this.z + Math.cos(walk.heading) * reach + Math.sin(walk.heading) * lateral,
      },
      yaw: walk.heading,
    }
    // H_sw = max(0.04 L, 0.08 L sqrt(l_i / l_ref)), with l_i half of this swing's travel.
    const stepLength = Math.hypot(land.position.x - lift.position.x, land.position.z - lift.position.z) / 2
    const legLength = this.traits.legLength
    const height = Math.max(swingHeightFloorShare * legLength, 0.08 * legLength * Math.sqrt(stepLength / this.referenceLength))
    return { land, reach, height }
  }

  private sampleSwing(swing: Swing): FootAnchor {
    const blend = cycloid(swing.progress)
    return {
      position: {
        x: swing.lift.position.x + (swing.land.position.x - swing.lift.position.x) * blend,
        y: this.traits.footBaselineY + swing.height * Math.sin(Math.PI * swing.progress),
        z: swing.lift.position.z + (swing.land.position.z - swing.lift.position.z) * blend,
      },
      yaw: swing.lift.yaw + wrap(swing.land.yaw - swing.lift.yaw) * blend,
    }
  }

  /** Stops at once when disabled: a lifted foot is put down where it is. */
  private halt() {
    if (this.swing) {
      const sample = this.sampleSwing(this.swing)
      this.feet[this.swing.foot] = { position: { ...sample.position, y: this.traits.footBaselineY }, yaw: sample.yaw }
    }
    const step = this.turn?.steps[this.turn.index]
    if (this.turn && step && this.turn.elapsed > 0) {
      const sample = step.sample(this.turn.elapsed)
      this.feet[step.foot] = { position: { ...sample.position, y: this.traits.footBaselineY }, yaw: sample.yaw }
    }
    this.swing = null
    this.walk = null
    this.turn = null
    this.speed = 0
  }

  private footFrame(side: Foot): LocomotionFoot {
    if (this.swing?.foot === side)
      return { target: this.sampleSwing(this.swing), planted: false, swing: this.swing.progress }
    const step = this.turn?.steps[this.turn.index]
    if (this.turn && step?.foot === side && this.turn.elapsed > 0)
      return { target: step.sample(this.turn.elapsed), planted: false, swing: this.turn.elapsed / step.duration }
    return { target: copyAnchor(this.feet[side]), planted: true, swing: null }
  }

  private frame(mode: LocomotionFrame['mode'], events: readonly GaitEvent[], pelvis: ReturnType<Locomotion['pelvis']>): LocomotionFrame {
    const strideScale = pelvis.length / this.referenceLength
    const support = this.support(this.phase)
    const lowerBodyYaw = 4 * radians * strideScale * this.lead(this.phase)
    const swingScale = Math.min(1.3, this.speed / this.referenceSpeed)
    const arm = (side: Foot) => {
      const flexion = 2 * radians - 12 * radians * swingScale * footSign[side] * this.lead(this.phase - 0.05)
      return { flexion, elbowFlex: 12 * radians + 0.5 * Math.max(0, flexion) }
    }
    return {
      mode,
      root: { position: { x: this.x, y: 0, z: this.z }, yaw: this.yaw },
      speed: this.speed,
      phase: this.phase,
      feet: { left: this.footFrame('left'), right: this.footFrame('right') },
      support,
      body: {
        pelvisLateral: pelvis.lateral,
        pelvisDrop: pelvis.drop,
        pelvisForeAft: 0,
        lowerBodyRoll: -3 * radians * strideScale * support,
        lowerBodyYaw,
        upperBodyRoll: 1.5 * radians * strideScale * support,
        chestCounterRoll: 0,
        spinePitch: 0.6 * this.lean.value,
        chestPitch: 0.4 * this.lean.value,
        chestCounterYaw: -0.5 * lowerBodyYaw,
      },
      armSwing: { left: arm('left'), right: arm('right') },
      weight: smoothstep(this.blend),
      events,
    }
  }
}

/**
 * Deterministic procedural gait on the 120 Hz grid. Planted anchors are frozen by
 * construction; landing targets are re-planned until 75% of the swing; root travel
 * follows a speed ramp of a_max = v_ref per second and stops exactly at the goal.
 */
export function createLocomotion({ traits, seed }: { traits: GaitTraits, seed: number }) {
  return new Locomotion(traits, seed)
}
