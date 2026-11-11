import type { MotionScenarioClass } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { MMDBody } from '@proj-airi/stage-ui-mmd/composables/mmd/body'

import { MMDFrameMetrics } from '@proj-airi/stage-ui-mmd/composables/mmd/frame-metrics'

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
  perFrameSeries: { columns: ['t_ms', 'mode', 'skate', 'feetMaxError'], rows: [number, string, number, number][] }
  perFrame: { t_ms: number[], penL: number[], penR: number[], clothL: number[], clothR: number[] }
}

// Same engine set as src/stage/measure.ts. Headless timings remain separate from rendered gate input.
const engineStages = new Set(['beforeUpdate', 'restore', 'commands', 'mixer.update', 'updateAnimation', 'capture', 'beforePhysics', 'physics.reset', 'physics.update', 'afterPhysics', 'render'])

/** Captures every scored stage sample; warm-up never contributes to percentiles. */
export class Motion3dMeasurement extends MMDFrameMetrics {
  scored = false
  private readonly samples = new Map<string, number[]>()
  private readonly rows: Motion3dRunSummary['perFrameSeries']['rows'] = []
  private readonly perFrame: Motion3dRunSummary['perFrame'] = { t_ms: [], penL: [], penR: [], clothL: [], clothR: [] }

  override recordStage(id: string, ms: number): void {
    if (!this.scored)
      return
    const samples = this.samples.get(id) ?? []
    samples.push(ms)
    this.samples.set(id, samples)
  }

  sample(diagnostics: MMDBody['diagnostics']): void {
    const t = this.rows.length * 1000 / 60
    const { locomotion, arms, feet } = diagnostics
    this.rows.push([t, locomotion?.mode ?? 'idle', locomotion?.skate ?? 0, locomotion ? feet.maxError : 0])
    this.perFrame.t_ms.push(t)
    this.perFrame.penL.push(arms?.penetration.left ?? 0)
    this.perFrame.penR.push(arms?.penetration.right ?? 0)
    this.perFrame.clothL.push(arms?.clothContact.left ?? 0)
    this.perFrame.clothR.push(arms?.clothContact.right ?? 0)
  }

  finish(input: Pick<Motion3dRunSummary, 'model' | 'scenario' | 'provenance'> & { poseStages: readonly string[], wallMs: number, simulatedSeconds: number }): Motion3dRunSummary {
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
      perFrameSeries: { columns: ['t_ms', 'mode', 'skate', 'feetMaxError'], rows: this.rows },
      perFrame: this.perFrame,
    }
  }
}
