import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { PreparedTrace, Quat } from '../metrics'

import { ARMS, UPPER } from '../metrics/bones'
import { conjugate, mean, multiply, normalize, rotationVector, yawQuat } from '../metrics/math'
import { headSignal, loopPeak, scalarSignals } from '../metrics/period'

export interface StylePosture {
  readonly skeleton: string
  readonly bones: readonly MotionTraceBone[]
  readonly pose: readonly Quat[]
}

export function stylePosture(p: PreparedTrace): StylePosture {
  const yaw = mean(p.yaw)
  const bones = UPPER.filter(b => p.orientations[b])
  const pose = bones.map((bone) => {
    const values = p.orientations[bone] ?? []
    const anchor = values[0]
    const sum = [0, 0, 0, 0]
    for (const q of values) {
      const sign = anchor.reduce((s, x, i) => s + x * q[i], 0) < 0 ? -1 : 1
      for (let i = 0; i < 4; i++)
        sum[i] += sign * q[i]
    }
    return multiply(yawQuat(-yaw), normalize([sum[0], sum[1], sum[2], sum[3]]))
  })
  return { skeleton: JSON.stringify({ bones: p.input.trace.rig.bones, parents: p.input.trace.rig.parents, restOffsets: p.input.trace.rig.restOffsets }), bones, pose }
}

export function emotionContext(styles: ReadonlyMap<string, StylePosture>): { readonly sharedSkeleton: boolean, readonly armShares: Readonly<Record<string, number>>, readonly pairDistances: Readonly<Record<string, number>>, readonly lower: number | null } {
  const neutral = styles.get('Neutral')
  const names = ['Angry', 'Depressed', 'Elated', 'Proud']
  if (!neutral || !names.every(name => styles.get(name)?.skeleton === neutral.skeleton))
    return { sharedSkeleton: false, armShares: {}, pairDistances: {}, lower: null }
  const vectors = new Map<string, readonly number[]>()
  const armShares: Record<string, number> = {}
  const armBones: readonly MotionTraceBone[] = ARMS
  for (const name of names) {
    const style = styles.get(name)
    if (!style)
      continue
    const v = style.pose.map((q, i) => rotationVector(multiply(q, conjugate(neutral.pose[i]))))
    const energy = v.map(r => r.reduce((s, x) => s + x * x, 0))
    const total = energy.reduce((s, x) => s + x, 0)
    if (total <= 1e-18)
      return { sharedSkeleton: true, armShares, pairDistances: {}, lower: null }
    armShares[name] = energy.reduce((s, x, i) => s + (armBones.includes(style.bones[i]) ? x : 0), 0) / total
    vectors.set(name, v.flat())
  }
  const pairDistances: Record<string, number> = {}
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = vectors.get(names[i]) ?? []
      const b = vectors.get(names[j]) ?? []
      pairDistances[`${names[i]}-${names[j]}`] = Math.sqrt(a.reduce((s, x, k) => s + (x - b[k]) ** 2, 0))
    }
  }
  return { sharedSkeleton: true, armShares, pairDistances, lower: 0.5 * Math.min(...Object.values(armShares)) }
}

/** Context only: the short-span loop statistic is never a fitted band. */
export function idleLoopContext(p: PreparedTrace): Readonly<Record<string, number | null>> {
  const scalars = scalarSignals(p)
  const head = headSignal(p)
  return Object.fromEntries(['rootLateral', 'rootForeAft', 'head'].map((name) => {
    const signal = name === 'head' ? head : scalars.get(name)
    return [name, signal ? loopPeak(signal) : null]
  }))
}
