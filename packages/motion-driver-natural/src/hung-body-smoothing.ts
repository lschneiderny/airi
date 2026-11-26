import type { Vec3 } from './posture'

/**
 * Seconds: time constant of each of the two poles that smooth the idle posture on a rig whose physics hangs the body
 * from the head. A posture shift starts within a grid step and the wobble reverses several times a second; unsmoothed,
 * both ring through every part the rig hangs from the head. Together the poles delay the posture by about 0.24 s.
 */
export const hungBodySmoothingSeconds = 0.12

/**
 * Two cascaded first-order low-passes over a head vector. The first step passes its input through, so switching the
 * smoothing on never moves the head.
 */
export class HungBodySmoothing {
  private poles: [Vec3, Vec3] | null = null

  /** Forgets the smoothed pose; the next step passes its input through. */
  reset() {
    this.poles = null
  }

  /** Advances both poles by `dt` seconds toward `value` and returns the smoothed vector. */
  step(value: Readonly<Vec3>, dt: number): Vec3 {
    if (this.poles === null) {
      this.poles = [[...value], [...value]]
      return [...value]
    }
    const blend = 1 - Math.exp(-dt / hungBodySmoothingSeconds)
    const [first, second] = this.poles
    for (const axis of [0, 1, 2] as const) {
      first[axis] += (value[axis] - first[axis]) * blend
      second[axis] += (first[axis] - second[axis]) * blend
    }
    return [...second]
  }
}
