import type { NaturalChannel } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/rig-profile'

import type { DrawableSource, T2Runtime } from './runner'

import { readLive2DRigProfile } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/rig-profile'

import { T2SetupError } from './errors'
import { startCubismFramework } from './runner'

/** A head move: a span where the head marker travels faster than this, in % of model height per second. */
const moveSpeed = 0.3
/** Seconds: two fast spans closer than this are one move. */
const moveGapSeconds = 0.1
/**
 * A span that travels less than this, in % of model height, is not a move: it is under one pixel on a character drawn
 * 1000 px tall. Continuous sub-second head motion breaks into such spans on a rig that moves far per degree.
 */
const moveFloor = 0.1
/**
 * A move shorter than this, in % of model height, is a small move: about one pixel on a character drawn 400 px tall,
 * so a viewer sees a twitch, not a move.
 */
const smallMove = 0.25
/** A reversal counts when the drawable swung at least this far, in % of model height, in at most `quickSeconds`. */
const reversalSwing = 0.2
const quickSeconds = 0.6
/** Opacity above which a drawable counts as drawn. */
const visibleOpacity = 0.05
/** Physics steps at 60 Hz that settle a rig after a parameter is pinned: 3 s. */
const settleSteps = 180
/** A drawable that a pinned parameter moves at least this far, in % of model height, belongs to that parameter. */
const markerDisplacement = 0.05

/** The channels Natural commands that move the picture: posture and breath. */
const gainChannels = ['headX', 'headY', 'headZ', 'bodyX', 'bodyY', 'bodyZ', 'breath'] as const satisfies readonly NaturalChannel[]
/** Parameters whose drawables mark the head, in order of preference. A silent idle run leaves the mouth shut, so it moves only with the head. */
const headMarkerIds = ['ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeBallX']

export interface HeadMoves {
  /** Moves per minute. A span that travels under 0.1 % of model height is not a move. */
  perMinute: number
  /** Net travel of the median move, in % of model height. */
  median: number
  /** Net travel of the 90th-percentile move, in % of model height. */
  p90: number
  /** Share of moves under 0.25 % of model height. */
  smallShare: number
  /** Share of frames outside a move. */
  stillShare: number
}

/**
 * Finds the head's moves in a marker path sampled at `hz`: spans faster than 0.3 % of model height per second, with
 * gaps under 0.1 s merged, that travel at least 0.1 %. A move's size is its net travel, so a wobble that returns to
 * its start is not a move. `x` and `y` are in % of model height.
 */
export function headMoves(x: ArrayLike<number>, y: ArrayLike<number>, hz: number): HeadMoves {
  const sizes: number[] = []
  let moveFrames = 0
  let start = -1
  let last = -1
  const close = () => {
    if (start < 0)
      return
    const size = Math.hypot(x[last] - x[start], y[last] - y[start])
    if (size < moveFloor)
      return
    sizes.push(size)
    moveFrames += last - start
  }
  for (let frame = 1; frame < x.length; frame++) {
    if (Math.hypot(x[frame] - x[frame - 1], y[frame] - y[frame - 1]) * hz <= moveSpeed)
      continue
    if (start < 0 || (frame - last) / hz > moveGapSeconds) {
      close()
      // The move starts at the sample before its first fast frame.
      start = frame - 1
    }
    last = frame
  }
  close()
  sizes.sort((a, b) => a - b)
  const quantile = (q: number) => sizes.length ? sizes[Math.min(sizes.length - 1, Math.floor(q * sizes.length))] : 0
  const minutes = x.length / hz / 60
  return {
    perMinute: sizes.length / minutes,
    median: quantile(0.5),
    p90: quantile(0.9),
    smallShare: sizes.length ? sizes.filter(size => size < smallMove).length / sizes.length : 0,
    stillShare: x.length > 1 ? 1 - moveFrames / (x.length - 1) : 1,
  }
}

/**
 * Counts quick reversals of a path sampled at `hz`, per minute: turning points, found with a hysteresis of 0.2 % of
 * model height, that come at most 0.6 s after the previous one. A limb that rings after a head move scores high; a
 * slow sway scores zero.
 */
export function quickReversalsPerMinute(path: ArrayLike<number>, hz: number): number {
  let direction = 0
  let high = 0
  let low = 0
  let previous = -1
  let quick = 0
  const turn = (at: number) => {
    if (previous >= 0 && (at - previous) / hz <= quickSeconds)
      quick++
    previous = at
  }
  for (let frame = 1; frame < path.length; frame++) {
    if (path[frame] > path[high])
      high = frame
    if (path[frame] < path[low])
      low = frame
    if (direction >= 0 && path[high] - path[frame] >= reversalSwing) {
      turn(high)
      direction = -1
      high = low = frame
    }
    else if (direction <= 0 && path[frame] - path[low] >= reversalSwing) {
      turn(low)
      direction = 1
      high = low = frame
    }
  }
  return quick / (path.length / hz / 60)
}

interface DrawableBox { x: number, y: number, minY: number, maxY: number, area: number, opacity: number }

function readDrawables(source: DrawableSource): DrawableBox[] {
  const boxes: DrawableBox[] = []
  for (let index = 0; index < source.count; index++) {
    const positions = source.vertexPositions[index]
    let x = 0
    let y = 0
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let v = 0; v < positions.length; v += 2) {
      x += positions[v]
      y += positions[v + 1]
      minX = Math.min(minX, positions[v])
      maxX = Math.max(maxX, positions[v])
      minY = Math.min(minY, positions[v + 1])
      maxY = Math.max(maxY, positions[v + 1])
    }
    const vertices = positions.length / 2
    boxes.push({ x: x / vertices, y: y / vertices, minY, maxY, area: vertices ? (maxX - minX) * (maxY - minY) : 0, opacity: source.opacities[index] })
  }
  return boxes
}

export interface RigScreenProfile {
  /** Height of the drawn picture at rest, in canvas units; every distance below is a share of it. */
  modelHeight: number
  /** Indices of the drawables drawn at rest. */
  visible: number[]
  /** Area of each visible drawable's box at rest, its weight in the picture measures. */
  areas: number[]
  /** Indices of the drawables that mark the head, and the parameter that found them. */
  head: { parameter: string, drawables: number[] }
  /**
   * How far each channel Natural commands moves the picture from its minimum to its maximum, with the rig's physics
   * settled: `mean` over the visible drawables weighted by area and `max` for the drawable that travels furthest,
   * both in % of model height. `null` marks a channel the rig's physics owns, and a channel the rig lacks is absent.
   */
  channels: Partial<Record<typeof gainChannels[number], { mean: number, max: number } | null>>
}

/**
 * Measures a rig without Natural: which drawables are drawn, which mark the head, and how far each posture channel
 * moves the picture. It pins one parameter at a time on a model of its own and lets the rig's physics settle, so a
 * body that physics derives from the head counts toward the head's channel.
 */
export function measureRigScreenProfile({ cubism4, rig }: T2Runtime): RigScreenProfile {
  startCubismFramework(cubism4)
  const moc = cubism4.CubismMoc.create(rig.moc)
  const core = moc.createModel()
  try {
    const physics = rig.physicsJson ? cubism4.CubismPhysics.create(rig.physicsJson) : undefined
    const raw = core.getModel()
    const parameters = raw.parameters
    const profile = readLive2DRigProfile(parameters, physics?._physicsRig, rig.displayInfoJson)
    const settle = (pin: number, value: number) => {
      parameters.values.set(parameters.defaultValues)
      for (let step = 0; step < settleSteps; step++) {
        if (pin >= 0)
          parameters.values[pin] = value
        physics?.evaluate(core, 1 / 60)
      }
      core.update()
      return readDrawables(raw.drawables)
    }

    const rest = settle(-1, 0)
    const visible = rest.flatMap((box, index) => box.opacity > visibleOpacity && box.area > 0 ? [index] : [])
    if (visible.length === 0)
      throw new T2SetupError(`The rig draws nothing at its default parameters: ${rig.modelJsonPath}`)
    const modelHeight = Math.max(...visible.map(index => rest[index].maxY)) - Math.min(...visible.map(index => rest[index].minY))
    const travel = (pin: number) => {
      const low = settle(pin, parameters.minimumValues[pin])
      const high = settle(pin, parameters.maximumValues[pin])
      return visible.map(index => Math.hypot(high[index].x - low[index].x, high[index].y - low[index].y) / modelHeight * 100)
    }
    const areas = visible.map(index => rest[index].area)
    const totalArea = areas.reduce((sum, area) => sum + area, 0)

    let head: RigScreenProfile['head'] | undefined
    for (const parameter of headMarkerIds) {
      const pin = parameters.ids.indexOf(parameter)
      if (pin < 0 || profile.physicsOutputs.has(parameter))
        continue
      const moved = travel(pin)
      const drawables = visible.filter((_, at) => moved[at] >= markerDisplacement)
      if (drawables.length) {
        head = { parameter, drawables }
        break
      }
    }
    if (!head)
      throw new T2SetupError(`No drawable marks the head: none of ${headMarkerIds.join(', ')} moves a drawn part of ${rig.modelJsonPath}`)

    const channels: RigScreenProfile['channels'] = {}
    for (const channel of gainChannels) {
      const range = profile.channels.get(channel)
      if (!range)
        continue
      if (profile.physicsOutputs.has(range.id)) {
        channels[channel] = null
        continue
      }
      const moved = travel(range.index)
      channels[channel] = { mean: moved.reduce((sum, value, at) => sum + value * areas[at], 0) / totalArea, max: Math.max(...moved) }
    }
    return { modelHeight, visible, areas, head, channels }
  }
  finally {
    moc.release()
  }
}

export interface ScreenMotionSummary {
  /** Moves of the head marker. */
  head: HeadMoves & {
    /** Spread of the head marker's position, in % of model height. */
    sd: number
  }
  /** The whole drawn picture, each drawable weighted by its area. */
  picture: {
    /** Spread of a drawable's position, in % of model height. */
    sd: number
    /** Mean speed of a drawable, in % of model height per second. */
    speed: number
    /** Quick reversals of a drawable along its main axis of motion, per minute. */
    quickReversalsPerMinute: number
  }
}

/**
 * Records where every drawn part of a model is on each frame and summarises how the picture moved, in % of model
 * height. It reads the deformed drawables, so the run needs mesh deformation.
 */
export class ScreenMotionRecorder {
  private readonly x: Float32Array[]
  private readonly y: Float32Array[]
  private frames = 0

  /** `maxFrames` bounds the recording; a sample past it throws. */
  constructor(private readonly profile: RigScreenProfile, private readonly maxFrames: number) {
    this.x = profile.visible.map(() => new Float32Array(maxFrames))
    this.y = profile.visible.map(() => new Float32Array(maxFrames))
  }

  /** Samples the drawables of the frame the core just deformed. */
  sample(source: DrawableSource) {
    if (this.frames >= this.maxFrames)
      throw new Error(`[qa-tools] screen motion recorder is full at ${this.maxFrames} frames`)
    const scale = 100 / this.profile.modelHeight
    this.profile.visible.forEach((index, at) => {
      const positions = source.vertexPositions[index]
      let x = 0
      let y = 0
      for (let v = 0; v < positions.length; v += 2) {
        x += positions[v]
        y += positions[v + 1]
      }
      const vertices = positions.length / 2
      this.x[at][this.frames] = x / vertices * scale
      this.y[at][this.frames] = y / vertices * scale
    })
    this.frames++
  }

  /** Summarises the frames from `skipSeconds` on, sampled at `hz`. */
  summarize(hz: number, skipSeconds: number): ScreenMotionSummary {
    const from = Math.round(skipSeconds * hz)
    const frames = this.frames - from
    if (frames < 2)
      throw new Error(`[qa-tools] screen motion needs frames after the first ${skipSeconds} s; the run recorded ${this.frames}`)
    const { visible, areas, head } = this.profile
    const totalArea = areas.reduce((sum, area) => sum + area, 0)
    const picture = { sd: 0, speed: 0, quickReversalsPerMinute: 0 }
    const headX = new Float64Array(frames)
    const headY = new Float64Array(frames)
    const headAt = new Set(head.drawables.map(index => visible.indexOf(index)))
    const main = new Float64Array(frames)
    for (let at = 0; at < visible.length; at++) {
      const x = this.x[at].subarray(from, this.frames)
      const y = this.y[at].subarray(from, this.frames)
      let meanX = 0
      let meanY = 0
      let travelled = 0
      for (let frame = 0; frame < frames; frame++) {
        meanX += x[frame]
        meanY += y[frame]
        if (frame > 0)
          travelled += Math.hypot(x[frame] - x[frame - 1], y[frame] - y[frame - 1])
        if (headAt.has(at)) {
          headX[frame] += x[frame] / headAt.size
          headY[frame] += y[frame] / headAt.size
        }
      }
      meanX /= frames
      meanY /= frames
      let xx = 0
      let yy = 0
      let xy = 0
      for (let frame = 0; frame < frames; frame++) {
        xx += (x[frame] - meanX) ** 2
        yy += (y[frame] - meanY) ** 2
        xy += (x[frame] - meanX) * (y[frame] - meanY)
      }
      // The main axis of a 2 by 2 covariance: the direction the drawable moves along most.
      const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
      for (let frame = 0; frame < frames; frame++)
        main[frame] = x[frame] * Math.cos(angle) + y[frame] * Math.sin(angle)
      const weight = areas[at] / totalArea
      picture.sd += weight * Math.sqrt((xx + yy) / frames)
      picture.speed += weight * travelled / ((frames - 1) / hz)
      picture.quickReversalsPerMinute += weight * quickReversalsPerMinute(main, hz)
    }
    let meanX = 0
    let meanY = 0
    for (let frame = 0; frame < frames; frame++) {
      meanX += headX[frame] / frames
      meanY += headY[frame] / frames
    }
    let variance = 0
    for (let frame = 0; frame < frames; frame++)
      variance += ((headX[frame] - meanX) ** 2 + (headY[frame] - meanY) ** 2) / frames
    return { head: { ...headMoves(headX, headY, hz), sd: Math.sqrt(variance) }, picture }
  }
}
