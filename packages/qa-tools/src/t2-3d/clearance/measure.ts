import type { ClearanceAnalysis, ClearanceClass, Side } from './analysis'
import type { Point } from './geometry'

import { CLEARANCE_CLASSES, PIERCED_CLASSES, SIDES } from './analysis'
import { distance, lerp, quantile, segmentCrossing, skinVertices } from './geometry'

/** The run summary's `clearance` block: how often and how deeply the arms pass through her body and clothing. */
export interface Motion3dClearance {
  /** Scored frames sampled, every `sampleStep`th frame of the 60 Hz run. */
  sampledFrames: number
  sampleStep: number
  /** Triangles under test by class, and the triangles left out as worn by the arm or as structural crossings. */
  triangles: { tested: number, worn: number, structural: number, byClass: Record<ClearanceClass, number> }
  /** The measured sleeve radius as a share of segment length. */
  sleeveRatio: { upper: number, fore: number }
  /** Share of sampled frames in which an arm segment crosses her body or clothing below the neck. */
  piercedShare: number
  /** Share of sampled frames with a crossing of each class, head and hair included. */
  byClass: Record<ClearanceClass, number>
  /** Share of sampled frames pierced by each tested segment. */
  bySegment: { upperArm: number, forearm: number, hand: number }
  /** The most pierced materials, by share of sampled frames. */
  topMaterials: { material: string, share: number }[]
  /** Per pierced frame, the share of the arm (from the shoulder) beyond the first crossing; `deepShare` is the share of sampled frames deeper than 0.25. */
  depth: { median: number, p90: number, deepShare: number }
  /** Runs of pierced samples, joined across a gap of one sample. */
  episodes: { count: number, longestSeconds: number }
  /** Upper-arm angle from straight down, degrees, over both sides and every sample. */
  upperArmDeg: { mean: number, p10: number, p90: number }
  /**
   * Simulated cloth, hips travel removed, model units per sample: the median and 99th percentile of each sample's 99th
   * percentile vertex travel, and the mean share of cloth vertices that reverse direction between samples (jitter).
   */
  cloth: { travelMedian: number, travelP99: number, reversalMean: number }
}

/** One posed frame: each bone's skinning matrix (world times inverse bind, column-major) and world position. */
export interface ClearancePose {
  readonly skin: Float64Array
  readonly joints: Float64Array
}

export interface ClearanceHit {
  readonly side: Side
  /** 0 the lower upper arm, 1 the forearm, 2 the hand. */
  readonly segment: number
  readonly cls: number
  readonly material: number
  /** Share of the arm, from the shoulder, beyond this crossing. */
  readonly beyond: number
  /** The triangle's index in the source's triangle list. */
  readonly triangle: number
}

/** Cloth vertices whose travel is followed, at most about this many. */
const CLOTH_SAMPLE_LIMIT = 1500
/** Travel below this per sample, about 5 cm/s at 30 Hz and 8 cm to the MMD unit, is rest noise, not jitter. */
const CLOTH_MOVING = 0.02
/** A vertex reverses when its travel turns by more than 120 degrees between samples. */
const CLOTH_REVERSAL_COS = -0.5
/** A pierced frame deeper than this share of the arm counts as deep. */
const DEEP_SHARE = 0.25
/** Without a middle finger, the hand segment reaches this share of the forearm past the wrist. */
const POSED_HAND_REACH = 0.3

/**
 * Samples posed frames against an analysis and summarizes them. It reads poses only; the caller decides which frames
 * to sample and passes the scored frame index, so episodes join samples `sampleStep` frames apart.
 */
export class ClearanceMeasure {
  private readonly world: Float64Array
  private sampled = 0
  private readonly pierced: { frame: number, depth: number }[] = []
  private readonly byClass = CLEARANCE_CLASSES.map(() => 0)
  private readonly bySegment = [0, 0, 0]
  private readonly byMaterial = new Map<number, number>()
  private readonly armDeg: number[] = []
  private readonly clothTravel: number[] = []
  private readonly clothReversal: number[] = []
  private readonly clothVertices: number[]
  private previousCloth: Float64Array | null = null
  private previousTravel: Float64Array | null = null
  private previousHips: Point = [0, 0, 0]

  constructor(private readonly analysis: ClearanceAnalysis, private readonly sampleStep: number) {
    this.world = new Float64Array(analysis.bind.length)
    const cloth = new Set<number>()
    for (let t = 0; t < analysis.classes.length; t++) {
      if (!CLEARANCE_CLASSES[analysis.classes[t]].endsWith('-cloth'))
        continue
      // Every corner, so the sample does not depend on the order a triangle lists them in.
      for (let corner = 0; corner < 3; corner++)
        cloth.add(analysis.triangles[t * 3 + corner])
    }
    const stride = Math.max(1, Math.floor(cloth.size / CLOTH_SAMPLE_LIMIT))
    this.clothVertices = [...cloth].filter((_, i) => i % stride === 0)
  }

  /** Measures one posed frame and returns its crossings. */
  sample(frame: number, pose: ClearancePose): ClearanceHit[] {
    skinVertices(this.analysis.bind, this.analysis.skinIndex, this.analysis.skinWeight, pose.skin, this.world)
    this.sampled++
    this.sampleCloth(pose)
    const hits = SIDES.flatMap(side => this.crossings(side, pose))
    const classes = new Set(hits.map(hit => hit.cls))
    classes.forEach(cls => this.byClass[cls]++)
    const pierced = hits.filter(hit => PIERCED_CLASSES.has(hit.cls))
    if (pierced.length) {
      new Set(pierced.map(hit => hit.segment)).forEach(segment => this.bySegment[segment]++)
      new Set(pierced.map(hit => hit.material)).forEach(material => this.byMaterial.set(material, (this.byMaterial.get(material) ?? 0) + 1))
      this.pierced.push({ frame, depth: Math.max(...pierced.map(hit => hit.beyond)) })
    }
    return hits
  }

  private joint(pose: ClearancePose, bone: number): Point {
    return [pose.joints[bone * 3], pose.joints[bone * 3 + 1], pose.joints[bone * 3 + 2]]
  }

  private crossings(side: Side, pose: ClearancePose): ClearanceHit[] {
    const arm = this.analysis.arms[side]
    if (!arm)
      return []
    const shoulder = this.joint(pose, arm.upper)
    const elbow = this.joint(pose, arm.elbow)
    const wrist = this.joint(pose, arm.wrist)
    const upperLength = distance(shoulder, elbow)
    this.armDeg.push(Math.acos(Math.max(-1, Math.min(1, (shoulder[1] - elbow[1]) / (upperLength || 1)))) * 180 / Math.PI)
    // The test starts halfway down the upper arm, as the guard's own does: the shoulder joint sits inside the chest.
    const chain = [lerp(shoulder, elbow, 0.5), elbow, wrist, arm.tip === null ? lerp(elbow, wrist, 1 + POSED_HAND_REACH) : this.joint(pose, arm.tip)]
    const lengths = [0, 1, 2].map(i => distance(chain[i], chain[i + 1]))
    const armLength = upperLength + lengths[1] + lengths[2]
    const lo = [0, 1, 2].map(axis => Math.min(...chain.map(p => p[axis])))
    const hi = [0, 1, 2].map(axis => Math.max(...chain.map(p => p[axis])))
    const v = this.world
    const { triangles, classes, materials, original } = this.analysis
    const hits: ClearanceHit[] = []
    for (let t = 0; t < classes.length; t++) {
      const a = triangles[t * 3] * 3
      const b = triangles[t * 3 + 1] * 3
      const c = triangles[t * 3 + 2] * 3
      if (Math.min(v[a], v[b], v[c]) > hi[0] || Math.max(v[a], v[b], v[c]) < lo[0]
        || Math.min(v[a + 1], v[b + 1], v[c + 1]) > hi[1] || Math.max(v[a + 1], v[b + 1], v[c + 1]) < lo[1]
        || Math.min(v[a + 2], v[b + 2], v[c + 2]) > hi[2] || Math.max(v[a + 2], v[b + 2], v[c + 2]) < lo[2]) {
        continue
      }
      for (let segment = 0; segment < 3; segment++) {
        const along = segmentCrossing(chain[segment], chain[segment + 1], v, a, b, c)
        if (along === null)
          continue
        let beyond = (1 - along) * lengths[segment]
        for (let later = segment + 1; later < 3; later++)
          beyond += lengths[later]
        hits.push({ side, segment, cls: classes[t], material: materials[t], beyond: beyond / (armLength || 1), triangle: original[t] })
      }
    }
    return hits
  }

  private sampleCloth(pose: ClearancePose): void {
    const sample = this.clothVertices
    if (!sample.length)
      return
    const hips = this.analysis.hips === null ? [0, 0, 0] as const : this.joint(pose, this.analysis.hips)
    const now = new Float64Array(sample.length * 3)
    sample.forEach((vertex, i) => now.set(this.world.subarray(vertex * 3, vertex * 3 + 3), i * 3))
    if (this.previousCloth) {
      const travel = new Float64Array(sample.length * 3)
      const lengths: number[] = []
      let reversed = 0
      for (let i = 0; i < sample.length; i++) {
        for (let k = 0; k < 3; k++)
          travel[i * 3 + k] = now[i * 3 + k] - this.previousCloth[i * 3 + k] - (hips[k] - this.previousHips[k])
        const length = Math.hypot(travel[i * 3], travel[i * 3 + 1], travel[i * 3 + 2])
        lengths.push(length)
        const before = this.previousTravel
        if (before) {
          const beforeLength = Math.hypot(before[i * 3], before[i * 3 + 1], before[i * 3 + 2])
          const dot = travel[i * 3] * before[i * 3] + travel[i * 3 + 1] * before[i * 3 + 1] + travel[i * 3 + 2] * before[i * 3 + 2]
          if (length > CLOTH_MOVING && beforeLength > CLOTH_MOVING && dot < CLOTH_REVERSAL_COS * length * beforeLength)
            reversed++
        }
      }
      this.clothTravel.push(quantile(lengths, 0.99))
      this.clothReversal.push(reversed / sample.length)
      this.previousTravel = travel
    }
    this.previousCloth = now
    this.previousHips = [hips[0], hips[1], hips[2]]
  }

  finish(): Motion3dClearance {
    const share = (count: number) => count / Math.max(1, this.sampled)
    const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
    // An episode lasts from its first pierced sample to the end of its last, the clear sample it joins across included.
    const episodes: { first: number, last: number }[] = []
    for (const { frame } of this.pierced) {
      const current = episodes.at(-1)
      if (current && frame - current.last <= this.sampleStep * 2)
        current.last = frame
      else
        episodes.push({ first: frame, last: frame })
    }
    const depths = this.pierced.map(entry => entry.depth)
    const { analysis } = this
    return {
      sampledFrames: this.sampled,
      sampleStep: this.sampleStep,
      triangles: { tested: analysis.classes.length, worn: analysis.counts.worn, structural: analysis.counts.structural, byClass: analysis.counts.byClass },
      sleeveRatio: { upper: analysis.sleeve.upper, fore: analysis.sleeve.fore },
      piercedShare: share(this.pierced.length),
      byClass: { 'upper-rigid': share(this.byClass[0]), 'upper-cloth': share(this.byClass[1]), 'lower-rigid': share(this.byClass[2]), 'lower-cloth': share(this.byClass[3]), 'head-rigid': share(this.byClass[4]), 'hair': share(this.byClass[5]) },
      bySegment: { upperArm: share(this.bySegment[0]), forearm: share(this.bySegment[1]), hand: share(this.bySegment[2]) },
      topMaterials: [...this.byMaterial].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5).map(([material, count]) => ({ material: analysis.materialNames[material] ?? `material-${material}`, share: share(count) })),
      depth: { median: quantile(depths, 0.5), p90: quantile(depths, 0.9), deepShare: share(depths.filter(depth => depth > DEEP_SHARE).length) },
      episodes: { count: episodes.length, longestSeconds: Math.max(0, ...episodes.map(episode => episode.last - episode.first + this.sampleStep)) / 60 },
      upperArmDeg: { mean: mean(this.armDeg), p10: quantile(this.armDeg, 0.1), p90: quantile(this.armDeg, 0.9) },
      cloth: { travelMedian: quantile(this.clothTravel, 0.5), travelP99: quantile(this.clothTravel, 0.99), reversalMean: mean(this.clothReversal) },
    }
  }
}
