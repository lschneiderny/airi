import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DecodedMotionTrace } from './read-trace'

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeBlock } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { diffMotion3d } from './cli/diff'
import { diffTraces, pairMismatches } from './diff'
import { DEG } from './metrics/math'
import { analyticTrace, angleX } from './metrics/test-trace'
import { TEST_BONES } from './reports/test-runs'

const turned = new Set<MotionTraceBone>(['leftLowerArm', 'leftHand'])
const events: MotionTraceEvent[] = [{ t: 1, kind: 'marker', label: 'a' }, { t: 2, kind: 'marker', label: 'b' }]

/** The forearm turns `deg` about X from `from` seconds on; the hand turns with it, so only the elbow's local rotation changes. */
function run(options: { deg?: number, from?: number, seed?: number, seconds?: number, events?: MotionTraceEvent[] } = {}): DecodedMotionTrace {
  const input = analyticTrace({
    seconds: options.seconds ?? 2,
    bones: TEST_BONES,
    scenario: 'talk',
    events: options.events ?? events,
    world: (bone, t) => angleX(turned.has(bone) && t >= (options.from ?? 0.5) ? (options.deg ?? 0) / DEG : 0),
  })
  const source = { ...input.trace.source, scenario: { ...input.trace.source.scenario, seed: options.seed ?? 1 } }
  return { ...input, trace: { ...input.trace, source } }
}

const block = (input: DecodedMotionTrace, other: DecodedMotionTrace, name: string) => diffTraces(input, other).find(b => b.name === name)

describe('diffTraces', () => {
  it('reads two runs of the same motion as identical in every block', () => {
    expect(diffTraces(run(), run()).every(b => b.identical)).toBe(true)
  })

  it('names the first differing frame and the largest turn on the bone that turned', () => {
    const rot = block(run(), run({ deg: 3, from: 0.5 }), 'rot')
    expect(rot?.identical).toBe(false)
    expect(rot?.first).toEqual({ frame: 30, t: 0.5 })
    expect(rot?.largest).toHaveLength(1)
    expect(rot?.largest[0].what).toBe('leftLowerArm')
    expect(rot?.largest[0].value).toBeCloseTo(3, 3)
    expect(diffTraces(run(), run({ deg: 3 })).filter(b => !b.identical).map(b => b.name)).toEqual(['rot'])
  })

  it('ignores only the fields that name the commit', () => {
    const tip = run()
    const relabelled = { ...tip, trace: { ...tip.trace, source: { ...tip.trace.source, gitSha: 'f'.repeat(40), dirty: true } } }
    expect(diffTraces(run(), relabelled).every(b => b.identical)).toBe(true)
    const detail = { ...tip, trace: { ...tip.trace, source: { ...tip.trace.source, detail: { three: '0.186.0' } } } }
    expect(block(run(), detail, 'detail')?.notes).toEqual(['three: undefined -> "0.186.0"'])
  })

  it('reports a moved event at its index while the motion stays identical', () => {
    const moved = run({ events: [events[0], { ...events[1], t: 2.5 }] })
    const diff = diffTraces(run(), moved)
    expect(diff.filter(b => !b.identical).map(b => b.name)).toEqual(['events'])
    expect(block(run(), moved, 'events')?.notes[0]).toMatch(/^first difference at event 1 /)
  })

  it('finds another seed, scenario version or scored length incomparable', () => {
    expect(pairMismatches(run(), run()).map(m => m.field)).toEqual([])
    const tip = run()
    const version3 = { ...tip, trace: { ...tip.trace, source: { ...tip.trace.source, detail: { scenarioVersion: 3 } } } }
    expect(pairMismatches(run(), version3).map(m => m.field)).toEqual(['scenario'])
    expect(pairMismatches(run(), run({ seed: 2 })).map(m => m.field)).toEqual(['seed'])
    expect(pairMismatches(run(), run({ seconds: 3 })).map(m => m.field)).toEqual(['length'])
  })
})

describe('qa:motion3d diff', () => {
  let root = ''
  const context = () => ({ repoRoot: root, cwd: root, signal: new AbortController().signal })
  const save = async (dir: string, input: DecodedMotionTrace) => {
    await mkdir(join(root, dir), { recursive: true })
    const trace = { ...input.trace, rot: encodeBlock(input.rot), root: encodeBlock(input.root), channels: encodeBlock(input.channels) }
    await writeFile(join(root, dir, 'trace.json'), JSON.stringify(trace))
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'motion3d-diff-'))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('exits 0 for identical runs, 1 for a different one and 2 for another seed unless it is allowed', async () => {
    await save('base', run())
    await save('same', run())
    await save('turned', run({ deg: 3 }))
    await save('seed2', run({ seed: 2 }))
    expect(await diffMotion3d(['base', 'same'], context())).toBe(0)
    expect(await diffMotion3d(['base', 'same', 'base', 'turned'], context())).toBe(1)
    expect(await diffMotion3d(['base', 'seed2'], context())).toBe(2)
    expect(await diffMotion3d(['base', 'seed2', '--allow-mismatch', 'seed'], context())).toBe(0)
    expect(await diffMotion3d(['base', 'same', '--allow-mismatch', 'commit'], context())).toBe(2)
  })

  it('matches two folders of runs by name and refuses a run present on one side only', async () => {
    await save('a/idle-1', run())
    await save('a/speak-1', run())
    await save('b/idle-1', run())
    await save('b/speak-1', run({ deg: 3 }))
    await save('c/idle-1', run())
    expect(await diffMotion3d(['a', 'b'], context())).toBe(1)
    expect(await diffMotion3d(['a', 'c'], context())).toBe(2)
  })
})
