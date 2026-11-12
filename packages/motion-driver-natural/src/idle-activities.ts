import type { GazePoint, NaturalGazeLayer } from './gaze'
import type { Vec3 } from './posture'
import type { RandomStream } from './random'

import { minJerk } from './processes'

/** Something she does on her own while nobody asks anything of her. `sleep` lasts as long as the user is away. */
export type IdleActivityKind = 'stretch' | 'yawn' | 'look-around' | 'check-in' | 'peer' | 'zone-out' | 'nod-off' | 'sway' | 'sleep'

/** Body language the host requests around a reach-out: the moment before she may speak, and letting the thought go. */
export type IdleCueKind = 'about-to-speak' | 'let-go'

export type IdleBehaviourKind = IdleActivityKind | IdleCueKind

/** Activities the scheduler draws; `sleep` is entered by the away rule, never drawn. */
export type DrawnIdleActivityKind = Exclude<IdleActivityKind, 'sleep'>

/**
 * What shapes her idle behaviour, set by the host from the slower character state and the desktop.
 * A neutral drive (all zero, no music) is a rested daytime character who talked a moment ago.
 */
export interface NaturalIdleDrive {
  /** Slow mood energy relative to her resting disposition, -1 (drained) to 1 (buzzing). */
  energy: number
  /** Slow mood valence relative to resting, -1 (upset) to 1 (bright). */
  valence: number
  /** Slow mood tension relative to resting, -1 to 1; positive is on edge. */
  tension: number
  /** 0 during the day, 1 deep in the night. */
  sleepiness: number
  /** 0 right after an exchange, 1 after a long time without one. */
  solitude: number
  /** Other applications are playing audio she can sway to. */
  music: boolean
  /**
   * Whether this layer may close her eyes and sleep while the user is away. A renderer that plays its own sleep
   * stance turns it off, so the two never stack.
   */
  allowSleep: boolean
  /** Multiplies how often activities start; 1 is the default pace, 0 leaves only sleep and cues. */
  rate: number
}

/** The per-step facts the controller already knows; this layer reads no other state. */
export interface IdleStepInput {
  /** `idle` and `watching` let activities start; any other mode ends them. */
  mode: 'idle' | 'watching' | 'listening' | 'thinking' | 'talking'
  /** The user has left the desktop. */
  away: boolean
  /** Another layer owns the head or the eyes (a pet, a chat glance, a gesture, a held emotion), so nothing new starts. */
  blocked: boolean
  /** Something happened that she must answer at once (a poke, an emotion, a cue gesture, a cursor she noticed). */
  interrupt: boolean
  /** A touch or a desktop wake: the only interruptions that wake her from sleep before the user is back. */
  rouse: boolean
  /** Eased screen inwardness, -1..1; the lean toward the screen follows its sign. */
  placement: number
  /** Where the screen content is, in normalized eye space. */
  screenPoint: GazePoint
}

/** What the layer adds to one grid step. Offsets are in the controller's normalized units; scales multiply. */
export interface IdleOutput {
  head: Vec3
  body: Vec3
  /** 0 leaves the lids alone, 1 closes them. Applied through the blink factor, so it can close eyes fully. */
  lidClose: number
  /** Multiplies eye openness; 1 leaves it. */
  eyeOpen: number
  eyeOpenHint: number
  browY: number
  mouthForm: number
  eyeSmile: number
  /** Added to the silent mouth opening; the controller drops it while speech owns the mouth. */
  mouthOpen: number
  amplitudeScale: number
  shiftRateScale: number
  continuousScale: number
  blinkIntervalScale: number
  breathPeriodScale: number
}

interface Glance {
  /** Active seconds at which the glance starts. */
  at: number
  point: GazePoint
  hold: number
}

interface Clip {
  kind: IdleBehaviourKind
  start: number
  /** Planned end; `Infinity` for a behaviour that lasts until it is released. */
  end: number
  releasedAt: number | null
  releaseSeconds: number
  side: -1 | 1
  /** Period of the sway, in seconds. */
  period: number
  /** Strength of the smile (check-in) or the sulk (let-go), 0..1. */
  tone: number
  /** Head keyframes of a look-around, or the droop lengths of a nod-off as `t`. */
  keys: { t: number, x: number, y: number }[]
  glances: Glance[]
}

/** Seconds a look-around head move takes; holds are longer, so each move completes. */
const lookMoveSeconds = 0.7
/** Seconds the head snaps up after a nod-off droop, and the seconds it takes to settle afterwards. */
const nodJerkSeconds = 0.28
const nodSettleSeconds = 1.3
/** Seconds the lids and head take to sink into sleep. */
const sleepSettleSeconds = 6
/** Seconds an ordinary wake takes, and a wake by touch. */
const wakeSeconds = 1.6
const startledWakeSeconds = 0.35
/** Seconds an interrupted activity takes to hand the body back. */
const interruptSeconds = 0.4
/** Longest wait, in seconds, for the model's decision before the about-to-speak hold lets go on its own. */
const aboutToSpeakMaxSeconds = 10
/** A decision that arrives after the hold ended still shows as letting go within this many seconds of its start. */
const letGoWindowSeconds = 30
/** Posture shifts slow down under an activity but never stop: a hold drawn at a lower rate would outlast it. */
const maxShiftCalm = 0.6
/** Seconds between two activities: the minimum and maximum of the uniform rest draw. */
const rest = { min: 6, max: 14 }
/** Mean seconds between activity starts at a neutral drive, on top of the rest. */
const meanGap = { idle: 45, watching: 70 }
/** Seconds the user must be away before she falls asleep: the bounds of the uniform draw. */
const sleepDelay = { min: 12, max: 30 }
/** A sleep at least this long, in seconds, can be followed by a stretch or a yawn. */
const longSleepSeconds = 90
/** Shortest seconds before the same activity is drawn again. */
const cooldowns: Record<DrawnIdleActivityKind, number> = { 'stretch': 300, 'yawn': 75, 'look-around': 25, 'check-in': 30, 'peer': 25, 'zone-out': 40, 'nod-off': 100, 'sway': 30 }

const drawnKinds = Object.keys(cooldowns) as DrawnIdleActivityKind[]

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function finite(value: number) {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
}

/** Rise over `attack`, hold, fall over `release`; 0 outside. Zero slope at every joint. */
function trapezoid(age: number, attack: number, hold: number, release: number) {
  if (age <= 0 || age >= attack + hold + release)
    return 0
  if (age < attack)
    return minJerk(age / attack)
  return age < attack + hold ? 1 : 1 - minJerk((age - attack - hold) / release)
}

function raisedCosine(u: number) {
  return u <= 0 || u >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * u)
}

function neutral(): IdleOutput {
  return { head: [0, 0, 0], body: [0, 0, 0], lidClose: 0, eyeOpen: 1, eyeOpenHint: 0, browY: 0, mouthForm: 0, eyeSmile: 0, mouthOpen: 0, amplitudeScale: 1, shiftRateScale: 1, continuousScale: 1, blinkIntervalScale: 1, breathPeriodScale: 1 }
}

/** A behaviour started, or the one that ran ended; `behaviour` names it in both cases. */
export interface IdleBehaviourReport {
  phase: 'start' | 'end'
  behaviour: IdleBehaviourKind
}

/**
 * Turns successive reads of the layer's `seq` and `behaviour` into start and end reports, each behaviour reported
 * once. A reader that samples once per frame uses it to follow behaviours without an observer.
 */
export class IdleBehaviourReports {
  private behaviour: IdleBehaviourKind | null = null
  private seq = 0

  /** The reports since the previous read, an end before the start that follows it. */
  read(state: { seq: number, behaviour: IdleBehaviourKind | null }): IdleBehaviourReport[] {
    const reports: IdleBehaviourReport[] = []
    const restarted = state.seq !== this.seq
    if (this.behaviour !== null && (restarted || state.behaviour === null))
      reports.push({ phase: 'end', behaviour: this.behaviour })
    if (state.behaviour !== null && (restarted || this.behaviour === null))
      reports.push({ phase: 'start', behaviour: state.behaviour })
    this.behaviour = state.behaviour
    this.seq = state.seq
    return reports
  }
}

/** The output while nothing contributes; shared, so a quiet layer allocates nothing per step. Never written. */
const idleRest: IdleOutput = Object.freeze(neutral())

/**
 * Relative odds of each drawn activity for a drive. Tiredness (night, or low mood energy) favours yawns, zoning out
 * and nodding off; a lively mood favours looking around and watching the screen; time without an exchange makes her
 * check on the user more; tension makes her restless. While the user is active (`watching`) she watches along more
 * and drifts off less. Sway is drawn only while music plays.
 */
export function idleActivityWeights(drive: NaturalIdleDrive, context: { watching: boolean }): Record<DrawnIdleActivityKind, number> {
  const tired = clamp01(Math.max(drive.sleepiness, -finite(drive.energy)))
  const lively = clamp01(finite(drive.energy))
  const warm = clamp01(0.5 + finite(drive.valence))
  const tense = clamp01(finite(drive.tension))
  const solitude = clamp01(drive.solitude)
  return {
    'look-around': (1 + 0.5 * lively + 0.6 * tense) * (1 - 0.5 * tired),
    'check-in': (0.45 + 0.6 * warm) * (1 + 0.8 * solitude) * (context.watching ? 1.2 : 1),
    'peer': (context.watching ? 1.6 : 0.35) * (1 + 0.4 * lively) * (1 - 0.5 * tired),
    'zone-out': (0.5 + 0.9 * tired + 0.4 * solitude) * (1 - 0.5 * tense) * (context.watching ? 0.5 : 1),
    'stretch': 0.3 + 0.3 * tired + 0.2 * tense,
    'yawn': 0.08 + 1.3 * tired,
    'nod-off': tired > 0.45 ? 1.4 * (tired - 0.45) / 0.55 * (context.watching ? 0.6 : 1) : 0,
    'sway': drive.music ? (0.8 + 0.6 * warm) * (1 - 0.6 * tense) : 0,
  }
}

/**
 * Activity starts per second for a drive: a lively mood fidgets more, a tired one less, and the host's `rate` scales
 * the whole pace. The rest between activities comes on top.
 */
export function idleActivityRate(drive: NaturalIdleDrive, context: { watching: boolean }): number {
  const pace = Math.max(0.5, Math.min(1.5, 1 + 0.35 * finite(drive.energy) + 0.25 * clamp01(finite(drive.tension))))
  return Math.max(0, Number.isFinite(drive.rate) ? drive.rate : 1) * pace / (context.watching ? meanGap.watching : meanGap.idle)
}

/** How far the slow mood and the hour move the user's Natural energy setting; 0 for a neutral drive. */
export function idleEnergyOffset(drive: NaturalIdleDrive | null): number {
  return drive === null ? 0 : 0.3 * finite(drive.energy) - 0.15 * clamp01(drive.sleepiness)
}

/**
 * Self-directed idle behaviour: named activities of a few seconds each, sleep while the user is away, and the body
 * language around a reach-out.
 *
 * - The layer is inert until the host sets a drive. Without one it draws nothing and adds nothing, so every seeded
 *   run from before it existed replays unchanged.
 * - Activities start by a hazard: `idleActivityRate` accumulates over eligible time and an activity starts when the
 *   sum crosses an `Exp(1)` draw, then `idleActivityWeights` picks which one. Each activity rests 6 to 14 s before
 *   the next can start, and each kind has its own cooldown.
 * - An activity yields at once to anything she must answer: speech, thinking, listening, a poke, a pet, an emotion,
 *   a cue gesture, a cursor she noticed. It fades out over 0.4 s and releases the gaze.
 * - While the user is away and the drive allows it, she falls asleep after 12 to 30 s and wakes when the user is
 *   back; a long sleep is often followed by a stretch or a yawn.
 * - Every random draw happens when a behaviour starts or ends, on this layer's own stream.
 *
 * Time is seconds of active motion. Call `step` once per grid step, then read `output`.
 */
export class NaturalIdleActivities {
  /** The contribution of the latest `step`; treat it as read-only. */
  output: IdleOutput = idleRest
  /** Increments each time a behaviour starts, so a host that samples per frame never misses a short one. */
  seq = 0

  private drive: NaturalIdleDrive | null = null
  private readonly clips: Clip[] = []
  private urge = 0
  private threshold: number | null = null
  private restUntil = 0
  private readonly lastStart: Partial<Record<IdleBehaviourKind, number>> = {}
  private lastDrawn: DrawnIdleActivityKind | null = null
  private awaySince: number | null = null
  private sleepAfter = 0
  private followUp: { kind: 'stretch' | 'yawn', at: number } | null = null
  private pendingCue: IdleCueKind | null = null
  /** Start time of the about-to-speak hold that a let-go already answered. */
  private answeredHold: number | null = null
  private eyesUntil = 0

  constructor(private readonly random: RandomStream) {}

  /** Whether any behaviour, running or fading out, contributes to `output`. */
  get contributing(): boolean {
    return this.clips.length > 0
  }

  /** The behaviour she is in now, or `null` between behaviours and while one fades out. */
  get behaviour(): IdleBehaviourKind | null {
    return this.active?.kind ?? null
  }

  /** `null` switches the layer off; a running behaviour then fades out at the next step. */
  setDrive(drive: NaturalIdleDrive | null) {
    this.drive = drive === null ? null : { ...drive }
  }

  /** How far the drive moves the Natural energy; 0 without a drive. */
  get energyOffset() {
    return idleEnergyOffset(this.drive)
  }

  /** Requests a reach-out cue; it starts at the next step and is dropped when the layer is off or she is busy. */
  cue(kind: IdleCueKind) {
    this.pendingCue = kind
  }

  /** Whether this layer holds the gaze at `at`, so autonomous attention shifts must wait. */
  eyesOwned(at: number) {
    return at < this.eyesUntil
  }

  /** Advances to the step that starts at `at` and samples the output at its end, `at + dt`. */
  step(at: number, dt: number, input: IdleStepInput, gaze: NaturalGazeLayer) {
    const drive = this.drive
    const performing = input.mode === 'idle' || input.mode === 'watching'
    let current = this.active

    if (current) {
      // Waiting to speak outlives the thinking mode of her own turn; everything else ends when a mode claims her.
      const claimed = current.kind === 'about-to-speak' ? input.mode === 'talking' || input.mode === 'listening' : !performing
      const interrupted = current.kind === 'sleep' ? input.rouse : input.interrupt
      if (drive === null || claimed || interrupted)
        this.release(current, at, current.kind === 'sleep' && interrupted ? startledWakeSeconds : interruptSeconds, gaze)
      else if (current.kind === 'sleep' && !input.away)
        this.wake(current, at, gaze)
      else if (current.kind === 'about-to-speak' && at - current.start >= aboutToSpeakMaxSeconds)
        this.release(current, at, 0.6, gaze)
      else if (at >= current.end)
        this.finish(current, at)
      current = this.active
    }
    for (let i = this.clips.length - 1; i >= 0; i--) {
      const clip = this.clips[i]
      if (clip.releasedAt !== null && at >= clip.releasedAt + clip.releaseSeconds)
        this.clips.splice(i, 1)
    }

    if (drive === null) {
      this.pendingCue = null
      this.followUp = null
      this.awaySince = null
      this.sample(at + dt)
      return
    }

    const cue = this.pendingCue
    this.pendingCue = null
    if (cue === 'about-to-speak' && performing && !input.blocked && current?.kind !== 'sleep') {
      if (current)
        this.release(current, at, interruptSeconds, gaze)
      current = this.start('about-to-speak', at, drive, input)
    }
    else if (cue === 'let-go' && performing && !input.blocked) {
      // A slow model can decide after the hold ran out; she still lets the thought go if nothing else started since.
      const held = this.lastStart['about-to-speak']
      const recent = !current && held !== undefined && at - held <= letGoWindowSeconds && this.answeredHold !== held
      if (current?.kind === 'about-to-speak' || recent) {
        if (current)
          this.release(current, at, 0.5, gaze)
        current = this.start('let-go', at, drive, input)
        // One hold earns one let-go.
        this.answeredHold = held ?? null
      }
    }

    if (input.away && drive.allowSleep) {
      if (this.awaySince === null) {
        this.awaySince = at
        this.sleepAfter = sleepDelay.min + (sleepDelay.max - sleepDelay.min) * this.random()
      }
      if (!current && performing && !input.blocked && at - this.awaySince >= this.sleepAfter)
        current = this.start('sleep', at, drive, input)
    }
    else {
      this.awaySince = null
    }

    const free = !current && performing && !input.blocked && !input.away
    if (this.followUp && at >= this.followUp.at) {
      const { kind } = this.followUp
      this.followUp = null
      if (free)
        current = this.start(kind, at, drive, input)
    }
    else if (free && at >= this.restUntil) {
      this.threshold ??= -Math.log(1 - this.random())
      this.urge += idleActivityRate(drive, { watching: input.mode === 'watching' }) * dt
      if (this.urge >= this.threshold) {
        this.urge = 0
        this.threshold = null
        const kind = this.pick(drive, input, at)
        if (kind)
          current = this.start(kind, at, drive, input)
      }
    }

    for (const clip of this.clips) {
      if (clip.releasedAt !== null)
        continue
      while (clip.glances.length > 0 && at >= clip.glances[0].at) {
        const glance = clip.glances.shift()!
        this.eyesUntil = Math.max(this.eyesUntil, gaze.glance(glance.point, glance.hold, at))
      }
    }
    this.sample(at + dt)
  }

  private get active(): Clip | undefined {
    return this.clips.find(clip => clip.releasedAt === null)
  }

  private release(clip: Clip, at: number, seconds: number, gaze: NaturalGazeLayer) {
    clip.releasedAt = at
    clip.releaseSeconds = seconds
    clip.glances.length = 0
    // Woken before the user is back, she takes a fresh while to fall asleep again.
    if (clip.kind === 'sleep')
      this.awaySince = null
    // The gaze returns to her own fixations at once; whatever claimed her issues its own glance on top.
    if (at < this.eyesUntil) {
      gaze.endHold(at)
      this.eyesUntil = at
    }
    this.restUntil = at + rest.min
  }

  private finish(clip: Clip, at: number) {
    // The shape has already returned to zero, so the clip retires without a fade.
    clip.releasedAt = at
    clip.releaseSeconds = 0
    this.restUntil = at + rest.min + (rest.max - rest.min) * this.random()
  }

  private wake(clip: Clip, at: number, gaze: NaturalGazeLayer) {
    const slept = at - clip.start
    clip.releasedAt = at
    clip.releaseSeconds = wakeSeconds
    // The eyes are already on the user when the lids open.
    this.eyesUntil = Math.max(this.eyesUntil, gaze.glance({ x: 0, y: 0 }, wakeSeconds + 0.6, at))
    this.restUntil = at + rest.min
    if (slept >= longSleepSeconds && this.random() < 0.7)
      this.followUp = { kind: this.random() < 0.6 ? 'stretch' : 'yawn', at: at + wakeSeconds + 0.8 + 1.2 * this.random() }
  }

  private pick(drive: NaturalIdleDrive, input: IdleStepInput, at: number): DrawnIdleActivityKind | null {
    const weights = idleActivityWeights(drive, { watching: input.mode === 'watching' })
    const eligible = drawnKinds.filter((kind) => {
      const last = this.lastStart[kind]
      return weights[kind] > 0 && (last === undefined || at - last >= cooldowns[kind])
    })
    // The same activity twice in a row reads as a loop, so it is drawn again only when nothing else is available.
    const pool = eligible.length > 1 ? eligible.filter(kind => kind !== this.lastDrawn) : eligible
    const total = pool.reduce((sum, kind) => sum + weights[kind], 0)
    if (total <= 0)
      return null
    let draw = this.random() * total
    for (const kind of pool) {
      draw -= weights[kind]
      if (draw < 0)
        return kind
    }
    return pool[pool.length - 1]
  }

  private start(kind: IdleBehaviourKind, at: number, drive: NaturalIdleDrive, input: IdleStepInput): Clip {
    const random = this.random
    const between = (min: number, max: number) => min + (max - min) * random()
    const drawnSide: -1 | 1 = random() < 0.5 ? -1 : 1
    const inwardSide: -1 | 1 = Math.abs(input.placement) > 0.1 ? (input.placement > 0 ? 1 : -1) : drawnSide
    const clip: Clip = { kind, start: at, end: at, releasedAt: null, releaseSeconds: 0, side: drawnSide, period: 2, tone: 0, keys: [], glances: [] }
    switch (kind) {
      case 'stretch':
        clip.end = at + 5.2
        break
      case 'yawn':
        clip.end = at + 4.2
        break
      case 'look-around': {
        const count = 2 + Math.floor(random() * 3)
        let side = drawnSide
        let t = 0
        clip.keys.push({ t: 0, x: 0, y: 0 })
        for (let i = 0; i < count; i++) {
          const point = { x: side * between(0.35, 0.7), y: between(-0.12, 0.22) }
          const hold = between(1.2, 2.6)
          clip.glances.push({ at: at + t, point, hold })
          // The eyes lead; the head follows 80 ms later and covers half of the turn.
          clip.keys.push({ t: t + 0.08, x: 0.55 * point.x, y: 0.4 * point.y })
          t += hold + 0.1
          if (random() < 0.7)
            side = side === 1 ? -1 : 1
        }
        clip.keys.push({ t, x: 0, y: 0 })
        clip.end = at + t + lookMoveSeconds + 0.1
        break
      }
      case 'check-in': {
        const duration = between(2.4, 4.2)
        clip.end = at + duration
        // An upset mood looks without smiling.
        clip.tone = finite(drive.valence) < -0.3 ? 0 : clamp01(0.5 + finite(drive.valence))
        clip.glances.push({ at, point: { x: 0, y: 0 }, hold: duration - 0.5 })
        break
      }
      case 'peer': {
        const duration = between(5, 9)
        clip.end = at + duration
        clip.side = inwardSide
        // Small saccades across the content, like reading along.
        for (let t = 0; t < duration - 1.2;) {
          const hold = Math.min(between(1.2, 2.4), duration - 1 - t)
          clip.glances.push({ at: at + t, point: { x: input.screenPoint.x + between(-0.08, 0.08), y: input.screenPoint.y + between(-0.04, 0.04) }, hold })
          t += hold + 0.05
        }
        break
      }
      case 'zone-out': {
        const duration = between(8, 18)
        clip.end = at + duration
        clip.glances.push({ at, point: { x: drawnSide * between(0.2, 0.4), y: between(-0.3, -0.15) }, hold: duration - 0.8 })
        break
      }
      case 'nod-off': {
        const cycles = 2 + Math.floor(random() * 2)
        let t = 0
        for (let i = 0; i < cycles; i++) {
          // Each droop is shorter than the last: she fights it less each time.
          const droop = between(2.5, 4) * 0.8 ** i
          clip.keys.push({ t, x: droop, y: 0 })
          t += droop + nodJerkSeconds + nodSettleSeconds
        }
        clip.end = at + t
        // Half of the time she checks whether anyone saw.
        if (random() < 0.5)
          clip.glances.push({ at: at + t - nodSettleSeconds + 0.2, point: { x: 0, y: 0 }, hold: 0.9 })
        break
      }
      case 'sway':
        clip.end = at + between(8, 16)
        clip.period = between(1.7, 2.3)
        clip.tone = clamp01(0.5 + finite(drive.valence))
        break
      case 'sleep':
        clip.end = Number.POSITIVE_INFINITY
        break
      case 'about-to-speak':
        clip.end = Number.POSITIVE_INFINITY
        clip.glances.push({ at, point: { x: 0, y: 0 }, hold: aboutToSpeakMaxSeconds })
        break
      case 'let-go':
        clip.end = at + 2.6
        clip.tone = clamp01(-finite(drive.valence))
        clip.glances.push({ at: at + 0.1, point: { x: drawnSide * 0.42, y: -0.2 }, hold: 1.5 })
        break
    }
    this.clips.push(clip)
    this.lastStart[kind] = at
    if (kind !== 'sleep' && kind !== 'about-to-speak' && kind !== 'let-go')
      this.lastDrawn = kind
    this.seq++
    return clip
  }

  private sample(time: number) {
    if (this.clips.length === 0) {
      this.output = idleRest
      return
    }
    const out = neutral()
    let calmAmplitude = 0
    let calmShift = 0
    let calmContinuous = 0
    for (const clip of this.clips) {
      const gain = clip.releasedAt === null ? 1 : clip.releaseSeconds <= 0 ? 0 : 1 - minJerk((time - clip.releasedAt) / clip.releaseSeconds)
      if (gain <= 0)
        continue
      const age = time - clip.start
      const s = clip.side
      const head = (x: number, y: number, z: number) => {
        out.head[0] += gain * x
        out.head[1] += gain * y
        out.head[2] += gain * z
      }
      const body = (x: number, y: number, z: number) => {
        out.body[0] += gain * x
        out.body[1] += gain * y
        out.body[2] += gain * z
      }
      const calm = (amplitude: number, shift: number, continuous: number) => {
        calmAmplitude = Math.max(calmAmplitude, gain * amplitude)
        calmShift = Math.max(calmShift, gain * shift)
        calmContinuous = Math.max(calmContinuous, gain * continuous)
      }
      switch (clip.kind) {
        case 'stretch': {
          // Arch back and up, squeeze the eyes, then settle a little lower than before.
          const e = trapezoid(age, 1.3, 1.5, 1.8)
          const settle = raisedCosine((age - 4) / 1.2)
          head(s * 0.06 * e, 0.34 * e - 0.06 * settle, s * 0.14 * e)
          body(0, 0.45 * e - 0.08 * settle, s * 0.1 * e)
          out.lidClose = Math.max(out.lidClose, gain * 0.9 * trapezoid(age - 0.5, 0.6, 1.4, 0.6))
          out.browY += gain * 0.25 * e
          out.mouthForm -= gain * 0.1 * e
          calm(0.5 * e, 0.5 * e, 0.6 * e)
          break
        }
        case 'yawn': {
          const e = trapezoid(age, 1.4, 0.9, 1.1)
          head(0, 0.16 * e, s * 0.04 * e)
          body(0, 0.22 * e, 0)
          out.mouthOpen += gain * 0.8 * e
          out.lidClose = Math.max(out.lidClose, gain * 0.85 * trapezoid(age - 0.7, 0.7, 0.9, 0.7))
          out.browY += gain * 0.35 * e
          calm(0.4 * e, 0.5 * e, 0.5 * e)
          break
        }
        case 'look-around': {
          let x = 0
          let y = 0
          for (let i = 1; i < clip.keys.length; i++) {
            const key = clip.keys[i]
            if (age < key.t)
              break
            const from = clip.keys[i - 1]
            const u = minJerk((age - key.t) / lookMoveSeconds)
            x = from.x + (key.x - from.x) * u
            y = from.y + (key.y - from.y) * u
          }
          head(x, y, 0)
          body(0.3 * x, 0, 0)
          calm(0.5, 0.5, 0.3)
          break
        }
        case 'check-in': {
          const e = trapezoid(age, 0.5, clip.end - clip.start - 1.3, 0.8)
          head(0, 0.03 * e, s * 0.07 * e)
          out.eyeSmile += gain * 0.3 * clip.tone * e
          out.mouthForm += gain * 0.2 * clip.tone * e
          out.browY += gain * 0.1 * e
          // A calmer posture brings the head back toward the camera while she looks.
          calm(0.5 * e, 0.5 * e, 0.3 * e)
          break
        }
        case 'peer': {
          const e = trapezoid(age, 0.9, clip.end - clip.start - 2, 1.1)
          head(s * 0.12 * e, -0.08 * e, s * 0.05 * e)
          body(s * 0.1 * e, -0.22 * e, s * 0.08 * e)
          out.eyeOpen *= 1 - gain * 0.08 * e
          out.browY -= gain * 0.08 * e
          calm(0.4 * e, 0.5 * e, 0.3 * e)
          break
        }
        case 'zone-out': {
          const e = trapezoid(age, 1.5, clip.end - clip.start - 2.1, 0.6)
          // The head lifts a little as she comes back.
          head(0, -0.07 * e + 0.05 * raisedCosine((age - (clip.end - clip.start - 0.9)) / 0.9), s * 0.04 * e)
          out.eyeOpen *= 1 - gain * 0.12 * e
          out.blinkIntervalScale *= 1 + gain * 0.8 * e
          out.breathPeriodScale *= 1 + gain * 0.15 * e
          calm(0.5 * e, 0.6 * e, 0.5 * e)
          break
        }
        case 'nod-off': {
          let pitch = 0
          let lid = 0
          let hint = 0
          for (const cycle of clip.keys) {
            const local = age - cycle.t
            const droop = cycle.x
            if (local < 0 || local >= droop + nodJerkSeconds + nodSettleSeconds)
              continue
            if (local < droop) {
              const u = local / droop
              pitch = -0.32 * u ** 1.5
              lid = 0.85 * minJerk(u)
            }
            else if (local < droop + nodJerkSeconds) {
              const v = minJerk((local - droop) / nodJerkSeconds)
              pitch = -0.32 + 0.38 * v
              lid = 0.85 * (1 - v)
              hint = 0.08 * v
            }
            else {
              const w = minJerk((local - droop - nodJerkSeconds) / nodSettleSeconds)
              pitch = 0.06 * (1 - w)
              hint = 0.08 * (1 - w)
            }
          }
          head(0, pitch, s * 0.25 * -pitch)
          out.lidClose = Math.max(out.lidClose, gain * lid)
          out.eyeOpenHint += gain * hint
          calm(0.5, 0.5, 0.4)
          break
        }
        case 'sway': {
          const e = trapezoid(age, 1.5, clip.end - clip.start - 3, 1.5)
          const phase = 2 * Math.PI * age / clip.period
          head(0.03 * e * Math.sin(phase - Math.PI / 2), 0, 0.07 * e * Math.sin(phase))
          body(0.1 * e * Math.sin(phase - 0.6), 0, 0.06 * e * Math.sin(phase - 0.6))
          out.mouthForm += gain * 0.08 * clip.tone * e
          calm(0.3 * e, 0.5 * e, 0.2 * e)
          break
        }
        case 'sleep': {
          const e = minJerk(age / sleepSettleSeconds)
          // Deep, slow breathing shows on the dropped head.
          head(s * 0.05 * e, -0.36 * e - 0.02 * e * Math.sin(2 * Math.PI * age / 6.5), s * 0.16 * e)
          body(0, -0.15 * e, s * 0.05 * e)
          out.lidClose = Math.max(out.lidClose, gain * e)
          out.breathPeriodScale *= 1 + gain * 0.4 * e
          calm(0.65 * e, 0.6 * e, 0.7 * e)
          break
        }
        case 'about-to-speak': {
          // A small breath in and a lifted look, held while she decides.
          const e = minJerk(age / 0.5)
          head(0, 0.05 * e, 0)
          body(0, 0.12 * e, 0)
          out.browY += gain * 0.14 * e
          out.eyeOpenHint += gain * 0.05 * e
          calm(0.4 * e, 0.5 * e, 0.3 * e)
          break
        }
        case 'let-go': {
          // The breath goes out and the look drops aside; a low mood shows it more.
          const e = trapezoid(age, 0.45, 1.2, 0.95)
          head(s * 0.1 * e, -0.09 * e, s * 0.03 * e)
          body(0, -0.1 * e, 0)
          out.mouthForm -= gain * 0.1 * (1 + clip.tone) * e
          out.browY -= gain * 0.05 * e
          calm(0.3 * e, 0.4 * e, 0.2 * e)
          break
        }
      }
    }
    out.amplitudeScale = 1 - calmAmplitude
    out.shiftRateScale = 1 - Math.min(maxShiftCalm, calmShift)
    out.continuousScale = 1 - calmContinuous
    this.output = out
  }
}
