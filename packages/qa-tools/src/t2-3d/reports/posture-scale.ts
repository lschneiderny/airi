import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { EmotionTrial, Quat } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'

import { emotionTrials, prepareTrace } from '../metrics'
import { multiply, normalize } from '../metrics/math'

/**
 * Architecture 4c posture table at weight 1, degrees (g2/motion-architecture.md 4c): TL and TM pitch the lower and
 * middle torso (positive forward), TLroll and TMyaw roll and yaw them, CE and CP elevate and protract both clavicles,
 * CEside elevates one clavicle, EL flexes the elbows, AB abducts the upper arms. The thinking hand and hand to chest
 * are acts, not angles, and are left out.
 */
export const POSTURE_TABLE: Readonly<Record<string, Readonly<Partial<Record<'TL' | 'TM' | 'TLroll' | 'TMyaw' | 'CE' | 'CP' | 'CEside' | 'EL' | 'AB' | 'neck' | 'head', number>>>>> = {
  happy: { TL: -2, TM: -2.5, CE: 1.5, CP: -2, EL: 6, AB: 3 },
  sad: { TL: 5, TM: 4, CE: -2, CP: 4, EL: -4 },
  angry: { TL: 2, TM: -1, CE: 3, CP: 3, EL: 10, AB: 5 },
  think: { TLroll: 2 },
  surprised: { TL: -4, TM: -3, CE: 6, EL: 15, AB: 8 },
  awkward: { CEside: 2, TLroll: 1.5, EL: 5 },
  question: { TL: 2, CEside: 1.5 },
  curious: { TL: 3.5, TM: 2, neck: 4, head: -4 },
  neutral: {},
  love: { TLroll: 2, CE: -1, CP: 2 },
  flustered: { CE: 4, CP: 3, EL: 12, TMyaw: 3 },
  sleepy: { TL: 4, TM: 3, CE: -2 },
}

/** The scales of the 4c table the report tries, in order: 0.25 to 8 in steps of 0.25. */
export const POSTURE_SCALES: readonly number[] = Array.from({ length: 32 }, (_, i) => (i + 1) * 0.25)

const RAD = Math.PI / 180
const minJerk = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u)
function axis(x: number, y: number, z: number, degrees: number): Quat {
  const s = Math.sin(degrees * RAD / 2)
  return [x * s, y * s, z * s, Math.cos(degrees * RAD / 2)]
}

/**
 * Unit M's designed 4c overlay at `scale` x the table: each emotion pulse adds its posture to the trace's local
 * rotations under the D4 afterglow (minimum-jerk attack over 0.5 s, held to +6 s, released by +8 s). Placebo and
 * neutral trials get nothing. Every other block of the trace is unchanged.
 */
export function overlayPostures(input: DecodedMotionTrace, scale: number): DecodedMotionTrace {
  const { trace } = input
  const pulses = trace.events.flatMap(e => e.kind === 'emotion' && e.phase === 'pulse' ? [{ t: e.t, posture: POSTURE_TABLE[e.emotion] ?? {} }] : [])
  const rot = input.rot.slice()
  const bones = trace.rig.bones
  const deltas: [MotionTraceBone, (p: (typeof POSTURE_TABLE)[string], w: number) => Quat][] = [
    ['spine', (p, w) => multiply(axis(1, 0, 0, w * (p.TL ?? 0)), axis(0, 0, 1, w * (p.TLroll ?? 0)))],
    ['chest', (p, w) => multiply(axis(1, 0, 0, w * (p.TM ?? 0)), axis(0, 1, 0, w * (p.TMyaw ?? 0)))],
    ['leftShoulder', (p, w) => multiply(axis(0, 0, 1, w * (p.CE ?? 0)), axis(0, 1, 0, -w * (p.CP ?? 0)))],
    ['rightShoulder', (p, w) => multiply(axis(0, 0, 1, -w * ((p.CE ?? 0) + (p.CEside ?? 0))), axis(0, 1, 0, w * (p.CP ?? 0)))],
    ['leftUpperArm', (p, w) => axis(0, 0, 1, w * (p.AB ?? 0))],
    ['rightUpperArm', (p, w) => axis(0, 0, 1, -w * (p.AB ?? 0))],
    ['leftLowerArm', (p, w) => axis(1, 0, 0, w * (p.EL ?? 0))],
    ['rightLowerArm', (p, w) => axis(1, 0, 0, w * (p.EL ?? 0))],
    ['neck', (p, w) => axis(1, 0, 0, w * (p.neck ?? 0))],
    ['head', (p, w) => axis(1, 0, 0, w * (p.head ?? 0))],
  ]
  for (let f = 0; f < trace.frames; f++) {
    const t = input.channels[f * 9]
    const pulse = pulses.find(x => t >= x.t && t <= x.t + 8)
    if (!pulse)
      continue
    const u = t - pulse.t
    const w = scale * minJerk(u / 0.5) * (1 - minJerk((u - 6) / 2))
    for (const [bone, delta] of deltas) {
      const b = bones.indexOf(bone)
      if (b < 0)
        continue
      const o = (f * bones.length + b) * 4
      rot.set(normalize(multiply(delta(pulse.posture, w), [rot[o], rot[o + 1], rot[o + 2], rot[o + 3]])), o)
    }
  }
  return { ...input, rot }
}

/**
 * Unit M3 item 5: per emotion, the first scale of the 4c table at which it clears `minimum` SD from neutral and from
 * the placebo on the designed overlay, with `separate` computing the separation table; null when no scale up to 8 does.
 * The sweep stops once every emotion has cleared.
 */
export function postureClearingScales(inputs: readonly DecodedMotionTrace[], separate: (trials: readonly EmotionTrial[]) => Readonly<Record<string, number>>, minimum: number): Record<string, number | null> {
  const emotions = Object.keys(POSTURE_TABLE).filter(e => e !== 'neutral')
  const found: Record<string, number | null> = Object.fromEntries(emotions.map(e => [e, null]))
  for (const scale of POSTURE_SCALES) {
    const trials = inputs.flatMap(input => emotionTrials(prepareTrace(overlayPostures(input, scale))))
    const separation = separate(trials)
    const pair = (a: string, b: string) => separation[a < b ? `${a}|${b}` : `${b}|${a}`]
    for (const emotion of emotions) {
      if (found[emotion] !== null || pair(emotion, 'neutral') === undefined)
        continue
      if (Math.min(pair(emotion, 'neutral'), pair(emotion, 'placebo') ?? 0) >= minimum)
        found[emotion] = scale
    }
    if (emotions.every(e => found[e] !== null || !trials.some(t => t.condition === e)))
      break
  }
  return found
}
