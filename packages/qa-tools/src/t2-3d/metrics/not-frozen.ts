import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { PreparedTrace, Quat, Vec3 } from './types'

import { conjugate, median, multiply, normalize } from './math'
import { placeWindows } from './segments'

/**
 * The default on-screen character height (`settings/mmd/stage-character-height`, `stage-ui-mmd` `stores/mmd.ts`). The
 * stage camera maps the character's plane to the window by a pure scale (`stage-shared` `calibrateCamera`), so a
 * displacement of d model units there draws as d * 560 / modelHeight DIP.
 */
export const STAGE_CHARACTER_HEIGHT_DIP = 560

/**
 * Gate version 4 (lane U revision 3, candidate K5-r): a region whose smoothness cannot be scored is skipped only when
 * its visible end moves at least this many DIP within a typical class window, else it is frozen. Each is the geometric
 * mean of the labelled cases' worst frozen and worst alive readings: head 0.381 (an invisible tremor) and 1.842 DIP (a
 * calm scaled head); arm 0.550 (an invisible tremor) and 5.823 DIP (a real idle arm). The frozen labels sit at the
 * visibility edge of 1 DIP; no human reference sets either threshold.
 */
export const NOT_FROZEN_DIP = { head: 0.8375, arm: 1.789 } as const

export type FrozenRegion = 'head' | 'armL' | 'armR'

/** The visible end of each region and the frame it is read in: the eyes in the chest frame, the wrist in the shoulder frame. */
const ENDS: Readonly<Record<FrozenRegion, { readonly frame: MotionTraceBone, readonly points: readonly MotionTraceBone[] }>> = {
  head: { frame: 'chest', points: ['leftEye', 'rightEye'] },
  armL: { frame: 'leftShoulder', points: ['leftHand'] },
  armR: { frame: 'rightShoulder', points: ['rightHand'] },
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const r = multiply(multiply(q, [v[0], v[1], v[2], 0]), conjugate(q))
  return [r[0], r[1], r[2]]
}

/** Linear interpolation at rank (n - 1) * p, the rule of `gate/bands.ts` `percentile`. */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (sorted.length - 1) * p
  const lower = Math.floor(rank)
  return sorted[lower] + (sorted[Math.ceil(rank)] - sorted[lower]) * (rank - lower)
}

/**
 * Median, over the class windows of the eligible spans, of the p95 displacement in DIP (default stage scale) of the
 * region's visible end from its window mean, in the region's frame. The model height is the rest height of the rig's
 * highest traced bone. Null without the bones, a positive model height or a window.
 */
export function windowedDisplacementDip(p: PreparedTrace, region: FrozenRegion): number | null {
  const { bones, parents, restOffsets } = p.input.trace.rig
  const { frame, points } = ENDS[region]
  const restHeight = (b: number): number => b < 0 ? 0 : restOffsets[b][1] + restHeight(parents[b])
  const modelHeight = Math.max(...bones.map((_, b) => restHeight(b)))
  const frameIndex = bones.indexOf(frame)
  const chains = points.map((point) => {
    const chain: number[] = []
    for (let b = bones.indexOf(point); b >= 0 && b !== frameIndex; b = parents[b])
      chain.push(b)
    return chain
  })
  const windows = placeWindows(p.eligibleSpans, p.windowSeconds)
  const frameOrientation = p.orientations[frame]
  if (modelHeight <= 0 || frameIndex < 0 || !frameOrientation || !windows.length || chains.some(c => !c.length || parents[c[c.length - 1]] !== frameIndex))
    return null
  const end = (i: number): Vec3 => {
    const toFrame = conjugate(frameOrientation[i])
    const sum = [0, 0, 0]
    for (const chain of chains) {
      for (const b of chain) {
        const parent = p.orientations[bones[parents[b]]]?.[i] ?? [0, 0, 0, 1]
        const v = rotate(normalize(multiply(toFrame, parent)), restOffsets[b])
        for (let c = 0; c < 3; c++)
          sum[c] += v[c] / chains.length
      }
    }
    return [sum[0], sum[1], sum[2]]
  }
  const dipPerUnit = STAGE_CHARACTER_HEIGHT_DIP / modelHeight
  return median(windows.map(({ start, end: stop }) => {
    const positions: Vec3[] = []
    for (let i = start; i < stop; i++)
      positions.push(end(i))
    const mean = [0, 1, 2].map(c => positions.reduce((s, v) => s + v[c], 0) / positions.length)
    return percentile(positions.map(v => Math.hypot(v[0] - mean[0], v[1] - mean[1], v[2] - mean[2])), 0.95) * dipPerUnit
  }))
}

/** The not-frozen reading of a region whose smoothness cannot be scored, with its threshold. */
export function notFrozen(p: PreparedTrace, region: FrozenRegion): { readonly dip: number | null, readonly threshold: number, readonly alive: boolean } {
  const dip = windowedDisplacementDip(p, region)
  const threshold = region === 'head' ? NOT_FROZEN_DIP.head : NOT_FROZEN_DIP.arm
  return { dip, threshold, alive: dip !== null && dip >= threshold }
}
