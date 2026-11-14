import type { FeatureCompareCell, FeatureCompareRollup, UsageHost } from '@proj-airi/stage-shared/perf/usage'

import type { UsageRollup } from './features'

/** Synthetic segment cells and rollups for the `features` and `compare` tests. */
export const fixtureHost: UsageHost = { platform: 'linux', arch: 'x64', cpuModel: 'AMD Ryzen 7 5800X3D', cores: 16, totalMemKb: 32_000_000, gpu: null }

const quartiles = (median: number) => ({ q1: median - 0.5, median, q3: median + 0.5 })

export interface FixtureCellOptions {
  readonly mmdPhysics?: boolean
  readonly sha?: string
  readonly dirty?: boolean | null
  readonly windows?: number
}

/** A stage-window cell whose median p50 frame time is `p50FrameMs`; the CPU median is 10 x that. */
export function fixtureCell(p50FrameMs: number, options: FixtureCellOptions = {}): FeatureCompareCell {
  const mmdPhysics = options.mmdPhysics ?? true
  return {
    epoch: 0,
    sha: options.sha ?? 'a'.repeat(40),
    dirty: options.dirty === undefined ? false : options.dirty,
    diffHash: null,
    window: 'stage-main',
    renderer: 'mmd',
    modelId: 'model-1',
    featureHash: mmdPhysics ? 'f-on' : 'f-off',
    features: { speechMuted: false, mmdPhysics, naturalMotion: true, mmdRoam: 'off', wakeWord: false, hearing: null },
    activity: 'idle',
    hostContended: false,
    stageHost: 'window',
    devtoolsOpen: false,
    refreshHz: 144,
    windows: options.windows ?? 30,
    frames: 9000,
    frameHist: Array.from<number>({ length: 22 }).fill(0),
    quartiles: { p50FrameMs: quartiles(p50FrameMs), share21: quartiles(0), share36: quartiles(0), share100: quartiles(0), cpuPct: quartiles(p50FrameMs * 10), workingSetKb: null },
    stages: null,
    incidents: 0,
  }
}

const FIXTURE_START = Date.parse('2026-11-10T00:00:00.000Z')
const BUCKET_MS = 300_000

/** One session per cell. */
export function fixtureRollups(cells: readonly FeatureCompareCell[]): FeatureCompareRollup[] {
  return cells.map((cell, index) => ({ sessionId: `session-${index}`, host: fixtureHost, cells: [cell] }))
}

/** The session of cell `index` starts `index` hours after the fixture start. */
export const fixtureSessionStart = (index: number) => FIXTURE_START + index * 3_600_000

/**
 * The sessions of {@link fixtureRollups} as `sessions.jsonl` holds them: each a 10 minute segment from
 * {@link fixtureSessionStart}, its cell split into two 5-minute buckets of half the windows and frames each.
 */
export function fixtureUsageRollups(cells: readonly FeatureCompareCell[]): UsageRollup[] {
  return fixtureRollups(cells).map((rollup, index) => ({
    ...rollup,
    cells: rollup.cells.map(({ windows, frames, frameHist, quartiles, stages, incidents, ...key }) => {
      const bucket = (part: 0 | 1) => ({
        startMs: fixtureSessionStart(index) + part * BUCKET_MS,
        endMs: fixtureSessionStart(index) + (part + 1) * BUCKET_MS,
        windows: part === 0 ? Math.ceil(windows / 2) : Math.floor(windows / 2),
        frames: part === 0 ? Math.ceil(frames / 2) : Math.floor(frames / 2),
        frameHist,
        quartiles,
        stages,
        incidents: part === 0 ? incidents : 0,
      })
      return { ...key, buckets: [bucket(0), bucket(1)] }
    }),
  }))
}
