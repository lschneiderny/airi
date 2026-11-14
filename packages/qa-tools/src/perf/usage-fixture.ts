import type { FeatureCompareCell, UsageHost } from '@proj-airi/stage-shared/perf/usage'

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

/** One session per cell, each a 10 minute segment starting `index` hours after `start`. */
export function fixtureRollups(cells: readonly FeatureCompareCell[], start = Date.parse('2026-11-10T00:00:00.000Z')): UsageRollup[] {
  return cells.map((cell, index) => ({
    sessionId: `session-${index}`,
    host: fixtureHost,
    startedAt: start + index * 3_600_000,
    endedAt: start + index * 3_600_000 + 600_000,
    cells: [cell],
  }))
}
