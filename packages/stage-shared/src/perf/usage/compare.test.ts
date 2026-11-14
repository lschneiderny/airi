import type { FeatureCompareCell, FeatureCompareRollup } from './compare'
import type { UsageHost } from './records'

import { describe, expect, it } from 'vitest'

import { compareFeature } from './compare'

const hostX: UsageHost = { platform: 'linux', arch: 'x64', cpuModel: 'AMD Ryzen 7 5800X3D', cores: 16, totalMemKb: 32_000_000, gpu: null }
const hostY: UsageHost = { ...hostX, cpuModel: 'Intel Core i7-1360P' }
const features = { speechMuted: false, mmdPhysics: true, naturalMotion: true, mmdRoam: 'off', wakeWord: false, hearing: null }
/** Spread of block medians around a side's centre. */
const JITTER = [-0.3, -0.1, 0, 0.1, 0.2, 0.3]

const quartiles = (median: number) => ({ q1: median - 0.5, median, q3: median + 0.5 })

/** One segment cell of the stage window whose median p50 frame time is `p50FrameMs`. */
function cell(p50FrameMs: number, options: { mmdPhysics?: boolean, windows?: number, hostContended?: boolean, leaseContended?: boolean | null } = {}): FeatureCompareCell {
  return {
    epoch: 0,
    sha: 'a'.repeat(40),
    dirty: false,
    diffHash: null,
    window: 'stage-main',
    renderer: 'mmd',
    modelId: 'model-1',
    featureHash: options.mmdPhysics === false ? 'f-off' : 'f-on',
    features: { ...features, mmdPhysics: options.mmdPhysics ?? true },
    activity: 'idle',
    hostContended: options.hostContended ?? false,
    stageHost: 'window',
    devtoolsOpen: false,
    refreshHz: 144,
    windows: options.windows ?? 30,
    frames: 9000,
    frameHist: Array.from<number>({ length: 22 }).fill(0),
    quartiles: { p50FrameMs: quartiles(p50FrameMs), share21: quartiles(0), share36: quartiles(0), share100: quartiles(0), cpuPct: null, workingSetKb: null },
    stages: null,
    incidents: 0,
    ...(options.leaseContended === undefined ? {} : { leaseContended: options.leaseContended }),
  }
}

/** One session per block, so no session holds both states. */
function separateSessions(off: number[], on: number[], host = hostX): FeatureCompareRollup[] {
  return [
    ...off.map((value, index) => ({ sessionId: `off-${host.cpuModel}-${index}`, host, cells: [cell(value, { mmdPhysics: false })] })),
    ...on.map((value, index) => ({ sessionId: `on-${host.cpuModel}-${index}`, host, cells: [cell(value)] })),
  ]
}

const around = (centre: number, count = JITTER.length) => JITTER.slice(0, count).map(offset => centre + offset)

/** Within-session noise for the paired tests; one value per session. */
const NOISE = [0.2, -0.3, 0.1, -0.1, 0.3, -0.2, 0.05, -0.05, 0.15, -0.15, 0.25, -0.25]

/** One block per side per session, the layout toggling a feature produces; session levels step by 2 ms from 10 ms. */
function pairedSessions(shift: number, sessions = NOISE.length): FeatureCompareRollup[] {
  return NOISE.slice(0, sessions).map((noise, session) => ({
    sessionId: `both-${session}`,
    host: hostX,
    cells: [cell(10 + 2 * session + noise, { mmdPhysics: false }), cell(10 + 2 * session + shift + NOISE[(session + 5) % NOISE.length])],
  }))
}

describe('compareFeature', () => {
  it('reports a 4 ms shift over six blocks per side as a difference whose interval excludes zero', () => {
    const report = compareFeature({ rollups: separateSessions(around(16), around(20)), feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })

    expect(report.label).toBe('observational')
    expect(report.comparisons).toHaveLength(1)
    const [comparison] = report.comparisons
    expect(comparison.a).toMatchObject({ value: false, blocks: 6, sessions: 6, windows: 180 })
    expect(comparison.b).toMatchObject({ value: true, blocks: 6, sessions: 6, windows: 180 })
    expect(comparison.verdict).toBe('difference')
    expect(comparison.basis).toBe('unpaired')
    expect(comparison.unpaired?.difference).toBeCloseTo(4)
    expect(comparison.unpaired?.ci.low).toBeGreaterThan(0)
    expect(comparison.unpaired?.cliffsDelta).toBe(1)
    expect(comparison.paired).toBeNull()
  })

  it('keeps sides without a shift within noise', () => {
    const report = compareFeature({ rollups: separateSessions(around(16), around(16).toReversed()), feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })

    const [comparison] = report.comparisons
    expect(comparison.verdict).toBe('within-noise')
    expect(comparison.unpaired?.ci.low).toBeLessThanOrEqual(0)
    expect(comparison.unpaired?.ci.high).toBeGreaterThanOrEqual(0)
  })

  it('reports too few blocks as insufficient with the counts', () => {
    const report = compareFeature({ rollups: separateSessions(around(16, 4), around(20)), feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })

    const [comparison] = report.comparisons
    expect(comparison.verdict).toBe('insufficient')
    expect(comparison.a).toMatchObject({ blocks: 4, sessions: 4, windows: 120 })
    expect(comparison.b).toMatchObject({ blocks: 6, sessions: 6, windows: 180 })
    expect(comparison.unpaired).toBeNull()
  })

  it('does not count cells with fewer than 24 windows as blocks', () => {
    const rollups = separateSessions(around(16), around(20)).map(rollup => ({ ...rollup, cells: rollup.cells.map(entry => ({ ...entry, windows: 23 })) }))

    const [comparison] = compareFeature({ rollups, feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons

    expect(comparison.verdict).toBe('insufficient')
    expect(comparison.a.blocks).toBe(0)
    expect(comparison.a.median).toBeNull()
  })

  it('never pools hosts: three blocks per side on each of two hosts stay insufficient', () => {
    const rollups = [...separateSessions(around(16, 3), around(20, 3), hostX), ...separateSessions(around(16, 3), around(20, 3), hostY)]

    const report = compareFeature({ rollups, feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })

    expect(report.comparisons.map(comparison => [comparison.stratum.cpuModel, comparison.verdict, comparison.a.blocks])).toEqual([
      [hostX.cpuModel, 'insufficient', 3],
      [hostY.cpuModel, 'insufficient', 3],
    ])
  })

  it('compares only cells whose other features match', () => {
    const rollups = separateSessions(around(16), around(20)).map((rollup, index) => index === 0
      ? { ...rollup, cells: rollup.cells.map(entry => ({ ...entry, features: { ...entry.features, wakeWord: true } })) }
      : rollup)

    const report = compareFeature({ rollups, feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })

    // The off block with the wake word on has no on counterpart, so it forms no comparison of its own.
    expect(report.comparisons).toHaveLength(1)
    expect(report.comparisons[0].a.blocks).toBe(5)
    expect(report.comparisons[0].stratum.otherFeatures.wakeWord).toBe(false)
  })

  it('prefers paired within-session differences, which see a shift that session levels hide from the unpaired estimate', () => {
    const [comparison] = compareFeature({ rollups: pairedSessions(2), feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons

    expect(comparison.basis).toBe('paired')
    expect(comparison.verdict).toBe('difference')
    expect(comparison.paired).toMatchObject({ sessions: 12, decisive: true })
    expect(comparison.paired?.difference).toBeCloseTo(2, 0)
    expect(comparison.unpaired?.verdict).toBe('within-noise')
  })

  it('lets the paired estimate decide from eight sessions, the first count whose exact sign-flip floor can fall below the paired difference', () => {
    const [seven] = compareFeature({ rollups: pairedSessions(2, 7), feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons
    const [eight] = compareFeature({ rollups: pairedSessions(2, 8), feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons

    expect(seven).toMatchObject({ basis: 'unpaired', paired: { sessions: 7, decisive: false } })
    expect(eight).toMatchObject({ basis: 'paired', paired: { sessions: 8, decisive: true } })
  })

  it('decides a consistent 4 ms shift over eight sessions by the paired estimate for every seed', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const [comparison] = compareFeature({ rollups: pairedSessions(4, 8), feature: 'mmdPhysics', metric: 'p50FrameMs', seed }).comparisons

      expect(comparison, `seed ${seed}`).toMatchObject({ verdict: 'difference', basis: 'paired', paired: { verdict: 'difference', decisive: true } })
    }
  })

  it('lets a strong unpaired result decide when too few sessions hold both states for pairing to reject', () => {
    const rollups = [0, 1, 2].map(session => ({
      sessionId: `both-${session}`,
      host: hostX,
      cells: [
        cell(16 + JITTER[2 * session], { mmdPhysics: false }),
        cell(16 + JITTER[2 * session + 1], { mmdPhysics: false }),
        cell(20 + JITTER[2 * session]),
        cell(20 + JITTER[2 * session + 1]),
      ],
    }))

    const [comparison] = compareFeature({ rollups, feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons

    expect(comparison).toMatchObject({ verdict: 'difference', basis: 'unpaired', paired: { sessions: 3, decisive: false } })
    expect(comparison.unpaired?.ci.low).toBeGreaterThan(0)
  })

  it('reports a 50 ms shift over five paired sessions as a difference, and no shift as noise', () => {
    const [shifted] = compareFeature({ rollups: pairedSessions(50, 5), feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons
    const [flat] = compareFeature({ rollups: pairedSessions(0, 5), feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons

    expect(shifted).toMatchObject({ verdict: 'difference', basis: 'unpaired', paired: { decisive: false } })
    expect(flat).toMatchObject({ verdict: 'within-noise', basis: 'unpaired', paired: { decisive: false } })
  })

  it('keeps paired sessions without a shift within noise, with a floor above zero at one block per side', () => {
    const [comparison] = compareFeature({ rollups: pairedSessions(0), feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons

    expect(comparison.basis).toBe('paired')
    expect(comparison.paired?.noiseFloor).toBeGreaterThan(0)
    expect(comparison.verdict).toBe('within-noise')
  })

  it('keeps a difference within noise when it does not exceed the A/A floor, even though its interval excludes zero', () => {
    const rollups = separateSessions([14, 14, 14.5, 15.5, 16, 16, 16.5], [13.5, 15, 17, 18, 19, 19.5, 19.5, 20.5])

    const [comparison] = compareFeature({ rollups, feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons

    expect(comparison.unpaired?.ci.low).toBeGreaterThan(0)
    expect(Math.abs(comparison.unpaired?.difference ?? 0)).toBeLessThanOrEqual(comparison.unpaired?.noiseFloor ?? 0)
    expect(comparison.verdict).toBe('within-noise')
  })

  it('drops host- and lease-contended cells but keeps cells whose lease state is unknown', () => {
    const rollups = [
      ...separateSessions(around(16), around(20)),
      { sessionId: 'noisy', host: hostX, cells: [cell(90, { hostContended: true }), cell(90, { leaseContended: true }), cell(20.1, { leaseContended: null })] },
    ]

    const report = compareFeature({ rollups, feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })

    expect(report.droppedCells).toEqual({ hostContended: 1, leaseContended: 1 })
    expect(report.comparisons[0].b).toMatchObject({ blocks: 7, sessions: 7 })
  })

  it('forms no comparison when the feature never changes in a stratum', () => {
    const rollups = separateSessions([], around(20))

    expect(compareFeature({ rollups, feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons).toEqual([])
  })

  it('handles identical block values without dividing by zero', () => {
    const flat = (value: number) => Array.from<number>({ length: 6 }).fill(value)

    const [same] = compareFeature({ rollups: separateSessions(flat(16), flat(16)), feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons
    const [shifted] = compareFeature({ rollups: separateSessions(flat(16), flat(20)), feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons
    const [zeroBase] = compareFeature({ rollups: separateSessions(flat(16), flat(20)), feature: 'mmdPhysics', metric: 'share100', seed: 1 }).comparisons

    expect(same.verdict).toBe('within-noise')
    expect(same.unpaired).toMatchObject({ difference: 0, noiseFloor: 0, ci: { low: 0, high: 0 }, cliffsDelta: 0 })
    expect(shifted.verdict).toBe('difference')
    expect(shifted.unpaired).toMatchObject({ difference: 4, noiseFloor: 0, ci: { low: 4, high: 4 } })
    expect(zeroBase.unpaired?.differencePct).toBeNull()
  })

  it('skips cells without a value for the metric', () => {
    const rollups = separateSessions(around(16), [...around(20), Number.NaN])

    const [comparison] = compareFeature({ rollups, feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 }).comparisons
    const [cpu] = compareFeature({ rollups, feature: 'mmdPhysics', metric: 'cpuPct', seed: 1 }).comparisons

    expect(comparison.b.blocks).toBe(6)
    expect(comparison.verdict).toBe('difference')
    expect(cpu).toMatchObject({ verdict: 'insufficient', a: { blocks: 0 }, b: { blocks: 0 } })
  })

  it('returns identical output for the same seed, whatever the input order', () => {
    const rollups = separateSessions([15.2, 16.9, 15.8, 17.3, 16.1, 15.5], [16.4, 18.8, 17.1, 19.6, 16.2, 18.1])
    const params = { feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 7 } as const

    const first = compareFeature({ ...params, rollups })

    expect(compareFeature({ ...params, rollups })).toEqual(first)
    expect(compareFeature({ ...params, rollups: rollups.toReversed() })).toEqual(first)
  })
})
