import { NaturalPostureLayers } from './posture'

/**
 * Test support only: runs `body` with each posture layer's first shift pushed `seconds` out, optionally without
 * continuous wobble. Gestures and reactions change shift timing only in their own run, so same-seed comparisons
 * would otherwise measure idle shifts.
 */
export function withPostureShiftsHeld<T>(body: () => T, options: { seconds?: number, quietContinuous?: boolean } = {}): T {
  const prototype = NaturalPostureLayers.prototype
  const step = prototype.step
  const held = new WeakSet<NaturalPostureLayers>()
  prototype.step = function (this: NaturalPostureLayers, ...args: Parameters<NaturalPostureLayers['step']>) {
    if (options.quietContinuous)
      this.continuousScale = 0
    if (!held.has(this)) {
      held.add(this)
      this.postponeShift(options.seconds ?? 60)
    }
    return step.apply(this, args)
  }
  try {
    return body()
  }
  finally {
    prototype.step = step
  }
}
