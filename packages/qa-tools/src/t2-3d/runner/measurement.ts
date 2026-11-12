import type { ClipMaskGroup } from '@proj-airi/motion-driver-humanoid/clip-mask'
import type { MotionScenarioClass } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { MMDBody, MMDBodyOwnership } from '@proj-airi/stage-ui-mmd/composables/mmd/body'

import { MMDFrameMetrics } from '@proj-airi/stage-ui-mmd/composables/mmd/frame-metrics'

/** The bone groups the MMD performer writes, as its diagnostics name them. */
export type MMDBodyWriteGroup = keyof NonNullable<MMDBody['diagnostics']['performance']>['writeDeviationRad']

export interface Motion3dRunSummary {
  kind: 'motion3d-run-summary'
  version: 1
  model: string
  scenario: { id: string, class: MotionScenarioClass, seed: number, seconds: number, warmupSeconds: number }
  provenance: Record<string, string | number | boolean | null>
  timing: {
    headless: true
    frames: number
    stages: Record<string, { meanMs: number, p50Ms: number, p95Ms: number, p99Ms: number, maxMs: number }>
    poseStageP95Ms: number
    airiStageP95Ms: number
    wallMs: number
    realtime: number
  }
  /**
   * One row per scored frame, read by column name. `skateContact` (the contact-point skate, owner decision O6) is appended
   * after `feetMaxError`; summaries written before it have four columns.
   */
  perFrameSeries: { columns: readonly string[], rows: readonly (readonly (number | string)[])[] }
  perFrame: { t_ms: number[], penL: number[], penR: number[], clothL: number[], clothR: number[] }
  /** Performer ticks, warm-up included, on which an arm had no clear pose and kept its previous one. */
  collisions: { count: number, last: { side: 'left' | 'right', depth: number, tick: number } | null }
  /** Arm ticks, warm-up included, on which the corrector's 6 degree cap bound, its guard scan began, or it held the arm. */
  corrector: { capHits: number, guardScans: number, holds: number }
  /** Clip ownership per mask group, one row per scored frame in `groups` order. */
  owned: { groups: ClipMaskGroup[], perFrame: number[][] }
  /**
   * Per scored frame: the largest angle (radians) between a written local rotation and the clean pose per written
   * group, the gesture-layer weight applied to each arm, and the nine displayed arm angles per side with their rest
   * values (degrees).
   */
  ownership: {
    groups: MMDBodyWriteGroup[]
    deviationRad: number[][]
    activation: { left: number[], right: number[] }
    armDeg: { left: number[][], right: number[][] }
    restArmDeg: { left: number[], right: number[] }
  }
  /**
   * Only with the synthetic claim clip: per scored frame, the clip's analytic rotation of each `bones` child relative to
   * its trace parent in the trace basis (xyzw, flattened), or null while the clip has no weight.
   */
  clip: { bones: string[], expected: (number[] | null)[] } | null
}

const OWNED_GROUPS: ClipMaskGroup[] = ['root', 'leftLegIk', 'rightLegIk', 'lowerBody', 'leftArm', 'rightArm', 'leftFingers', 'rightFingers', 'upperBody', 'head']
const WRITE_GROUPS: MMDBodyWriteGroup[] = ['hips', 'torso', 'head', 'leftArm', 'rightArm', 'leftFingers', 'rightFingers']

// Same engine set as src/stage/measure.ts. Headless timings remain separate from rendered gate input.
const engineStages = new Set(['beforeUpdate', 'restore', 'commands', 'mixer.update', 'updateAnimation', 'capture', 'beforePhysics', 'physics.reset', 'physics.update', 'afterPhysics', 'render'])

/** Captures every scored stage sample; warm-up never contributes to percentiles. */
export class Motion3dMeasurement extends MMDFrameMetrics {
  scored = false
  private readonly samples = new Map<string, number[]>()
  private readonly rows: [number, string, number, number, number][] = []
  private readonly perFrame: Motion3dRunSummary['perFrame'] = { t_ms: [], penL: [], penR: [], clothL: [], clothR: [] }
  private readonly owned: number[][] = []
  private readonly ownership: Motion3dRunSummary['ownership'] = { groups: WRITE_GROUPS, deviationRad: [], activation: { left: [], right: [] }, armDeg: { left: [], right: [] }, restArmDeg: { left: [], right: [] } }
  private readonly clip: (number[] | null)[] = []
  private clipSeen = false

  override recordStage(id: string, ms: number): void {
    if (!this.scored)
      return
    const samples = this.samples.get(id) ?? []
    samples.push(ms)
    this.samples.set(id, samples)
  }

  sample(diagnostics: MMDBody['diagnostics'], owned: MMDBodyOwnership, clip: number[] | null): void {
    const t = this.rows.length * 1000 / 60
    const { locomotion, arms, feet, performance } = diagnostics
    this.owned.push(OWNED_GROUPS.map(group => owned[group]))
    this.ownership.deviationRad.push(WRITE_GROUPS.map(group => performance?.writeDeviationRad[group] ?? 0))
    this.ownership.activation.left.push(performance?.gestureActivation.left ?? 0)
    this.ownership.activation.right.push(performance?.gestureActivation.right ?? 0)
    this.ownership.armDeg.left.push(performance?.arms.deg.left ?? [])
    this.ownership.armDeg.right.push(performance?.arms.deg.right ?? [])
    if (performance)
      this.ownership.restArmDeg = { left: performance.arms.restDeg.left, right: performance.arms.restDeg.right }
    this.clip.push(clip)
    this.clipSeen ||= clip !== null
    this.rows.push([t, locomotion?.mode ?? 'idle', locomotion?.skate ?? 0, locomotion ? feet.maxError : 0, locomotion?.skateContact ?? 0])
    this.perFrame.t_ms.push(t)
    this.perFrame.penL.push(arms?.penetration.left ?? 0)
    this.perFrame.penR.push(arms?.penetration.right ?? 0)
    this.perFrame.clothL.push(arms?.clothContact.left ?? 0)
    this.perFrame.clothR.push(arms?.clothContact.right ?? 0)
  }

  finish(input: Pick<Motion3dRunSummary, 'model' | 'scenario' | 'provenance' | 'collisions' | 'corrector'> & { poseStages: readonly string[], wallMs: number, simulatedSeconds: number, clipBones: readonly string[] | null }): Motion3dRunSummary {
    const stages = Object.fromEntries([...this.samples].map(([id, samples]) => {
      const sorted = [...samples].sort((a, b) => a - b)
      const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]
      return [id, {
        meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
        maxMs: sorted[sorted.length - 1],
      }]
    }))
    return {
      kind: 'motion3d-run-summary',
      version: 1,
      model: input.model,
      scenario: input.scenario,
      provenance: input.provenance,
      timing: {
        headless: true,
        frames: this.rows.length,
        stages,
        poseStageP95Ms: input.poseStages.reduce((sum, id) => sum + (stages[id]?.p95Ms ?? 0), 0),
        airiStageP95Ms: Object.entries(stages).reduce((sum, [id, stage]) => sum + (engineStages.has(id) ? 0 : stage.p95Ms), 0),
        wallMs: input.wallMs,
        realtime: input.simulatedSeconds * 1000 / input.wallMs,
      },
      perFrameSeries: { columns: ['t_ms', 'mode', 'skate', 'feetMaxError', 'skateContact'], rows: this.rows },
      perFrame: this.perFrame,
      collisions: input.collisions,
      corrector: input.corrector,
      owned: { groups: OWNED_GROUPS, perFrame: this.owned },
      ownership: this.ownership,
      clip: input.clipBones ? { bones: [...input.clipBones], expected: this.clip } : null,
    }
  }
}
