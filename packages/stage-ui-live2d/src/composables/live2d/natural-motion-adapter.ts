import type { Live2DMotionDriver } from './live2d'
import type { PixiLive2DInternalModel } from './motion-manager'

import { Live2DNaturalMotion } from './natural-motion'

type Core = PixiLive2DInternalModel['coreModel']
type Parameters = ReturnType<Core['getModel']>['parameters']
interface FocusModel {
  coreModel: Pick<Core, 'getParameterValueByIndex' | 'setParameterValueByIndex'>
  updateFocus: () => void
}
interface Attention {
  driver: Live2DMotionDriver
  manualActive: boolean
  springActive: boolean
  exclusive: boolean
  motion: {
    group: string | undefined
    idleGroup: string
    selectedIdleGroup: string | null
    priority: number
  }
  cursor: { x: number, y: number } | null
}

const channels = {
  headX: 'ParamAngleX',
  headY: 'ParamAngleY',
  headZ: 'ParamAngleZ',
  bodyX: 'ParamBodyAngleX',
  bodyY: 'ParamBodyAngleY',
  bodyZ: 'ParamBodyAngleZ',
  eyeX: 'ParamEyeBallX',
  eyeY: 'ParamEyeBallY',
} as const

const clamp = (value: number, limit = 1) => Math.max(-limit, Math.min(limit, value))

/**
 * Owns late focus composition for one loaded model. Frame timestamps are SDK seconds.
 * The active clock freezes across pause/visibility changes, but not visible stalls.
 * Disposal restores the original SDK method before the model is destroyed.
 */
export class Live2DNaturalMotionAdapter {
  private readonly controller: Live2DNaturalMotion
  private readonly originalFocus: () => void
  private readonly ranges
  private time = 0
  private frameTime: number | undefined
  private paused = false
  private hidden = false
  private eligible = false
  private weight = 0
  private velocity = 0
  private destination = 0
  private start = 0
  private duration = 0
  private points = [0, 0, 0, 0]
  private disposed = false
  private readonly visibilityChanged = () => {
    this.hidden = this.visibility?.hidden ?? false
    this.frameTime = undefined
    this.controller.setSuspended(this.paused || this.hidden || !this.eligible, this.time)
  }

  constructor(
    private readonly model: FocusModel,
    parameters: Pick<Parameters, 'ids' | 'defaultValues' | 'minimumValues' | 'maximumValues'>,
    private readonly attention: () => Attention,
    private readonly visibility?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>,
    random = Math.random,
  ) {
    this.controller = new Live2DNaturalMotion({ random })
    this.controller.setSuspended(true, 0)
    this.ranges = Object.entries(channels).flatMap(([axis, id]) => {
      const index = parameters.ids.indexOf(id)
      if (index < 0 || parameters.maximumValues[index] === parameters.minimumValues[index])
        return []
      return [{
        axis: axis as keyof typeof channels,
        id,
        index,
        neutral: parameters.defaultValues[index],
        min: parameters.minimumValues[index],
        max: parameters.maximumValues[index],
      }]
    })
    this.originalFocus = model.updateFocus
    // NOTICE:
    // SDK focus follows AIRI final plugins and precedes physics.
    // Late composition avoids saved-pose feedback and duplicate focus offsets.
    // Source: pixi-live2d-display Cubism4InternalModel.update().
    // Remove this wrapper when the SDK exposes a public pre-physics composition hook.
    model.updateFocus = () => this.compose()
    this.visibilityChanged()
    visibility?.addEventListener('visibilitychange', this.visibilityChanged)
  }

  setPaused(paused: boolean) {
    this.paused = paused
    this.frameTime = undefined
    this.controller.setSuspended(paused || this.hidden || !this.eligible, this.time)
  }

  frame(nowSeconds: number) {
    if (this.disposed)
      return
    if (!this.paused && !this.hidden && this.frameTime !== undefined)
      this.time += nowSeconds - this.frameTime
    this.frameTime = nowSeconds
  }

  private blend() {
    if (this.duration === 0)
      return
    const t = this.time >= this.start + this.duration ? 1 : (this.time - this.start) / this.duration
    const s = 1 - t
    const [a, b, c, d] = this.points
    this.weight = s ** 3 * a + 3 * s ** 2 * t * b + 3 * s * t ** 2 * c + t ** 3 * d
    this.velocity = 3 * (s ** 2 * (b - a) + 2 * s * t * (c - b) + t ** 2 * (d - c)) / this.duration
    if (t === 1) {
      this.weight = this.destination
      this.velocity = 0
      this.duration = 0
    }
  }

  private compose() {
    const { driver, manualActive, springActive, exclusive, motion, cursor } = this.attention()
    const idle = !motion.group || motion.group === motion.idleGroup || motion.group === motion.selectedIdleGroup
    // SDK MotionPriority.IDLE is 1. Keep this module independent of SDK runtime loading.
    const eligible = driver === 'natural' && !manualActive && !springActive && !exclusive
      && (idle || motion.priority <= 1)
    this.blend()
    if (eligible !== this.eligible) {
      this.eligible = eligible
      this.destination = eligible ? 1 : 0
      const nominal = eligible ? 0.45 : 0.20
      const bound = this.velocity > 0 ? 1 - this.weight : this.weight
      this.duration = this.velocity === 0 ? nominal : Math.min(nominal, 3 * bound / Math.abs(this.velocity))
      this.start = this.time
      this.points = [this.weight, this.weight + this.velocity * this.duration / 3, this.destination, this.destination]
      this.controller.setSuspended(this.paused || this.hidden || !eligible, this.time)
    }
    this.controller.setCursor(cursor, this.time)
    const { pose, fixation } = this.controller.advance(this.time)
    // SDK focus creates synthetic values for absent IDs. Full ownership must
    // bypass those writes, not merely overwrite the model's existing channels.
    if (this.weight < 1)
      this.originalFocus.call(this.model)
    if (this.weight === 0)
      return

    // Head/body are composed first. Fixation remains unclamped metadata so eyes
    // compensate the commanded head, rather than a reconstructed clamped gaze.
    const head = { x: 0, y: 0 }
    for (const range of this.ranges) {
      const normal = this.model.coreModel.getParameterValueByIndex(range.index)
      let command = pose[range.axis]
      if (range.axis === 'eyeX')
        command = clamp(fixation.x - head.x, 0.95)
      if (range.axis === 'eyeY')
        command = clamp(fixation.y - head.y, 0.95)
      // Physics derives this body axis from the head; todo 9 owns the full ownership rewrite.
      if (command === null)
        continue
      const natural = range.neutral + command * (command >= 0 ? range.max - range.neutral : range.neutral - range.min)
      const blended = this.weight === 1 ? natural : normal + (natural - normal) * this.weight
      const delta = blended - range.neutral
      const span = delta >= 0 ? range.max - range.neutral : range.neutral - range.min
      const normalized = span === 0 ? 0 : delta / span
      if (range.axis === 'headX')
        head.x = normalized
      if (range.axis === 'headY')
        head.y = normalized
      this.model.coreModel.setParameterValueByIndex(range.index, blended)
    }
  }

  dispose() {
    if (this.disposed)
      return
    this.disposed = true
    this.visibility?.removeEventListener('visibilitychange', this.visibilityChanged)
    this.model.updateFocus = this.originalFocus
  }
}
