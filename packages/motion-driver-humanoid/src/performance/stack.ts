import type { TurnStep } from '../look-at'
import type { BodyActFeedback, BodyCapabilities, BodyGazeGoal, BodyPerformanceFrame, BodyPerformanceInput, BodyRigTraits } from './contracts'

import { createInertializer, minJerk } from '../dynamics'
import { BODY_CHANNELS, BODY_TICK } from './channels'

export interface PerformanceContext {
  readonly input: BodyPerformanceInput
  readonly traits: BodyRigTraits
  readonly capabilities: BodyCapabilities
  readonly rest: Float32Array
  readonly previous: BodyPerformanceFrame
  readonly tick: number
  readonly time: number
  readonly dt: number
}

export interface LayerOutput {
  /** BODY_CHANNELS-sized borrowed targets and analytic velocities, radians or L per second. */
  readonly channels: ArrayLike<number>
  readonly velocities?: ArrayLike<number>
  /** Desired weight [0,1]; the stack provides minimum-jerk entry and exit. */
  readonly weight: number
  /** Changes on a cut between performances; weight changes alone are not cuts. */
  readonly sequence: number
  /** Additional channels for mixed layers, e.g. override arms plus additive torso. */
  readonly additive?: ArrayLike<number>
  readonly lidClose?: number
  readonly mouthOpen?: number
  readonly act?: BodyActFeedback | null
  readonly footSteps?: readonly TurnStep[]
}

/** Intent overrides are sampled before generators; targets still blend in stack order afterwards. */
export interface PerformancePlan {
  readonly support?: number
  readonly gaze?: BodyGazeGoal
}

export interface PerformanceLayer {
  readonly id: string
  readonly order: 'emotion' | 'act' | 'gesture' | 'cue' | 'reaction'
  readonly mode: 'additive' | 'override'
  readonly mask: ArrayLike<number>
  readonly enterSeconds?: number
  readonly exitSeconds?: number
  plan?: (context: PerformanceContext) => PerformancePlan
  step: (context: PerformanceContext) => LayerOutput
  reset: () => void
}

const order = { emotion: 0, act: 1, gesture: 2, cue: 3, reaction: 4 } as const
const emptySteps: readonly TurnStep[] = []

/** Channels stay warm under ownership; admission decisions belong to each layer via context.input.owned. */
export class PerformanceStack {
  readonly activation = new Float64Array(BODY_CHANNELS.length)
  readonly plan: { support: number | null, gaze: BodyGazeGoal | null } = { support: null, gaze: null }
  lidClose = 0
  mouthOpen = 0
  act: BodyActFeedback | null = null
  footSteps: readonly TurnStep[] = emptySteps
  private readonly entries
  private readonly inertia = createInertializer(BODY_CHANNELS.length, BODY_TICK)
  private readonly previous = new Float64Array(BODY_CHANNELS.length)
  private readonly velocity = new Float64Array(BODY_CHANNELS.length)
  private readonly targetVelocity = new Float64Array(BODY_CHANNELS.length)
  private readonly cut = new Uint8Array(BODY_CHANNELS.length)
  private warm = false

  constructor(layers: readonly PerformanceLayer[]) {
    this.entries = [...layers].sort((a, b) => order[a.order] - order[b.order]).map(layer => ({
      layer,
      sequence: -1,
      weight: 0,
      from: 0,
      target: 0,
      elapsed: 0,
      duration: 0,
    }))
  }

  prepare(context: PerformanceContext): void {
    this.plan.support = null
    this.plan.gaze = null
    for (const { layer } of this.entries) {
      const plan = layer.plan?.(context)
      if (plan?.support !== undefined)
        this.plan.support = plan.support
      if (plan?.gaze !== undefined)
        this.plan.gaze = plan.gaze
    }
  }

  step(channels: Float64Array, context: PerformanceContext): void {
    this.activation.fill(0)
    this.targetVelocity.fill(0)
    this.cut.fill(0)
    this.lidClose = this.mouthOpen = 0
    this.act = null
    this.footSteps = emptySteps
    for (const entry of this.entries) {
      const { layer } = entry
      const output = layer.step(context)
      if (output.weight !== entry.target) {
        entry.from = entry.weight
        entry.target = output.weight
        entry.elapsed = 0
        entry.duration = output.weight > entry.weight ? layer.enterSeconds ?? 0.25 : layer.exitSeconds ?? 0.35
      }
      entry.elapsed += BODY_TICK
      entry.weight = entry.duration === 0 ? entry.target : entry.from + (entry.target - entry.from) * minJerk(entry.elapsed / entry.duration)
      const cut = entry.sequence >= 0 && output.sequence !== entry.sequence
      entry.sequence = output.sequence
      const weight = entry.weight
      for (let c = 0; c < channels.length; c++) {
        const w = weight * layer.mask[c]
        if (cut && w > 0)
          this.cut[c] = 1
        if (layer.mode === 'override') {
          channels[c] += w * (output.channels[c] - channels[c])
          this.activation[c] = Math.max(this.activation[c], w)
          this.targetVelocity[c] += w * ((output.velocities?.[c] ?? 0) - this.targetVelocity[c])
        }
        else {
          channels[c] += w * output.channels[c]
          this.targetVelocity[c] += w * (output.velocities?.[c] ?? 0)
        }
        if (output.additive)
          channels[c] += weight * output.additive[c]
      }
      this.lidClose = Math.max(this.lidClose, weight * (output.lidClose ?? 0))
      this.mouthOpen = Math.max(this.mouthOpen, weight * (output.mouthOpen ?? 0))
      if (output.act)
        this.act = output.act
      if (output.footSteps?.length)
        this.footSteps = output.footSteps
    }
    this.inertia.step()
    for (let c = 0; c < channels.length; c++) {
      if (this.cut[c] && this.warm) {
        this.inertia.cut(c, this.previous[c] - channels[c] - this.inertia.positions[c], this.velocity[c] - this.targetVelocity[c] - this.inertia.velocities[c])
      }
      channels[c] += this.inertia.positions[c]
      this.velocity[c] = this.warm && !this.cut[c] ? (channels[c] - this.previous[c]) / BODY_TICK : this.targetVelocity[c] + this.inertia.velocities[c]
      this.previous[c] = channels[c]
    }
    this.warm = true
  }
}
