import type { MotionScenarioClass } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DetectorParameters } from '../metrics'

export type Side = 'two' | 'lower' | 'upper'
export type Transform = 'none' | 'fisher-z'
export interface BandRule {
  readonly side: Side
  readonly domain: readonly [number | null, number | null]
  readonly transform: Transform
  readonly unit: 'clip' | 'episode'
}
export interface MetricBand extends BandRule {
  readonly basis: 'fitted' | 'declared'
  readonly status: 'GATED' | 'REPORT'
  readonly detail: string
  readonly n: number
  readonly p5: number | null
  readonly p50: number | null
  readonly p95: number | null
  readonly lo: number | null
  readonly hi: number | null
  readonly exclusiveHi?: boolean
  readonly rule?: string
  readonly source?: string
  readonly episodeCounts?: Readonly<Record<string, number>>
  readonly heldoutEpisodeCounts?: Readonly<Record<string, number>>
  readonly heldoutEpisodes?: number
}
export interface HoldoutVerdict {
  readonly clipSha256?: string
  readonly dataset?: string
  readonly subject?: string
  readonly group?: number
  readonly metric?: string
  readonly value?: number
  readonly verdict: 'PASS' | 'FAIL'
  readonly failed: readonly string[]
  readonly values?: Readonly<Record<string, number | null>>
}
export interface ClassBands extends DetectorParameters {
  readonly window: { readonly seconds: number, readonly hopSeconds: number }
  readonly fit: readonly { readonly clipSha256: string, readonly dataset: string, readonly subject: string, readonly seconds: number, readonly hasFingers: boolean }[]
  readonly holdout: readonly HoldoutVerdict[]
  readonly metrics: Readonly<Record<string, MetricBand>>
}
export interface MotionBandsFile {
  readonly kind: 'mmd-motion-bands'
  readonly gate: { readonly id: 'mmd-motion-quality', readonly version: number }
  readonly fixture: boolean
  readonly builtAt: string
  readonly tool: { readonly gitSha: string, readonly rule: 'P5-P50-P95-one-tail-margin' }
  readonly datasets: readonly { readonly id: string, readonly licence: string, readonly url: string, readonly clips: number }[]
  readonly classes: Readonly<Partial<Record<MotionScenarioClass, ClassBands>>>
  readonly context: Readonly<Record<string, unknown>>
}
export interface VerdictMetric {
  readonly id: string
  readonly family: string
  readonly status: 'PASS' | 'FAIL' | 'REPORT' | 'SKIPPED'
  readonly value: number | null
  readonly unit: string
  readonly basis: 'fitted' | 'declared' | null
  readonly band: MetricBand | null
  readonly detail: string
}
export interface MotionVerdict {
  readonly kind: 'mmd-motion-verdict'
  readonly gate: { readonly id: 'mmd-motion-quality', readonly version: number, readonly fileSha256: string, readonly bandsSha256: string }
  readonly trace: { readonly path: string, readonly sha256: string, readonly level: string | null, readonly scenario: string | null, readonly class: string | null, readonly seed: number | null, readonly scoredSeconds: number, readonly hz: number }
  readonly verdict: 'PASS' | 'FAIL' | 'REFUSED'
  readonly refusal: { readonly name: string, readonly detail: string } | null
  readonly metrics: readonly VerdictMetric[]
  readonly counts: { readonly pass: number, readonly fail: number, readonly report: number, readonly skipped: number }
  readonly requirements?: { readonly metrics: readonly string[], readonly passed: boolean }
  readonly pooledFrom?: {
    readonly traces: readonly { readonly directory: string, readonly sha256: string }[]
    readonly trialCounts: Readonly<Record<string, number>>
  }
  readonly limitation: string
}
