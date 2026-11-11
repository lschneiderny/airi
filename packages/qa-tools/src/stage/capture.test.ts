import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Transformer } from '@napi-rs/image'
import { MotionTraceRecorder } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { MMD_POSE_STAGE_IDS, MMD_SURFACE_STAGE_IDS } from '@proj-airi/stage-ui-mmd/composables/mmd/stage-composition'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readTrace } from '../t2-3d/read-trace'
import { runStageCli } from './cli'

const cdp = vi.hoisted(() => ({ connect: vi.fn(), target: vi.fn(), evaluate: vi.fn(), send: vi.fn(), close: vi.fn() }))
vi.mock('@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug', async (original) => {
  const actual = await original<typeof import('@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug')>()
  return { ...actual, CdpClient: { connect: cdp.connect }, findDebugTarget: cdp.target }
})

let dir: string
let model: string | null
let driver: string
let refusal: string | null
let frameHz: number
let probeHz: number | undefined
let recordingPass: number
let noticeDismissed: boolean | 'absent'
let sceneStages: { pose: string[], surface: string[] }
const context = { repoRoot: join(import.meta.dirname, '../../../..'), cwd: '', selfPids: [] }

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'stage-capture-'))
  context.cwd = dir
  model = 'fixture'
  driver = 'natural'
  refusal = null
  frameHz = 60
  probeHz = undefined
  recordingPass = 0
  noticeDismissed = 'absent'
  sceneStages = { pose: [...MMD_POSE_STAGE_IDS], surface: [...MMD_SURFACE_STAGE_IDS] }
  vi.useFakeTimers()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  cdp.connect.mockResolvedValue(cdp)
  cdp.target.mockResolvedValue({ type: 'page', url: 'http://stage/?synced-leader=true#/', webSocketDebuggerUrl: 'ws://fixture' })
  const png = await Transformer.fromRgbaPixels(new Uint8Array([20, 80, 120, 255]), 1, 1).png()
  cdp.send.mockResolvedValue({ result: { data: png.toString('base64') } })
  cdp.evaluate.mockImplementation(async (expression: string) => {
    if (expression.includes('data-sonner-toast'))
      return noticeDismissed
    if (expression === 'performance.now()')
      return 1000
    if (expression.includes('document.visibilityState'))
      return { frames: 30, visibility: 'visible' }
    if (expression.includes('startTrace'))
      recordingPass++
    const hz = recordingPass === 1 ? probeHz ?? frameHz : frameHz
    const recorder = new MotionTraceRecorder()
    recorder.start({
      kind: 'motion-trace',
      version: 1,
      hz: 60,
      scoredFrom: 0,
      rig: { id: 'fixture', assetSha256: null, legLength: 1, bones: ['hips'], parents: [-1], restOffsets: [[0, 0, 0]], physicsOwned: [], eyeSource: 'none', hasFingers: false },
      source: { level: 'rendered', scenario: { id: 'attach', class: 'idle', seed: 7 }, gitSha: null, dirty: null, stages: sceneStages, omitted: [], detail: {} },
    })
    for (let index = 0; index < 601; index++)
      recorder.sample(index / hz, index / hz, () => ({ x: 0, y: 0, z: 0, w: 1 }), { x: index, y: 0, z: 0 }, {})
    recorder.stop()
    if (expression.includes('drainTrace'))
      return expression.includes('"from":600') ? recorder.drain(600, 1) : recorder.drain(0, 600)
    return {
      snapshot: {
        loadedModelKey: model,
        driver,
        rig: { legLength: 1 },
        world: null,
        locomotion: null,
        trace: { state: expression.includes('startTrace') ? 'recording' : 'stopped', frames: 601, refused: expression.includes('startTrace') ? refusal : null },
      },
      nowMs: 1000,
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const args = ['capture', '--port', '9222', '--scenario', 'attach', '--seconds', '1', '--shots', '1', '--seed', '7', '--out', 'capture']

describe('qa:stage capture', () => {
  it.each([true, false, 'absent'] as const)('writes noticeDismissed %s without failing the capture', async (status) => {
    noticeDismissed = status
    const run = runStageCli(args, context)
    await vi.runAllTimersAsync()
    expect(await run).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'capture/capture.json'), 'utf8'))).toMatchObject({ noticeDismissed: status })
  })

  it.each([
    [['capture'], 'capture needs'],
    [[...args, '--seconds', '121'], '--seconds'],
    [[...args, '--shots', '0'], '--shots'],
    [[...args, '--seed', '1.5'], '--seed'],
    [[...args, '--mode', 'wrong'], '--mode'],
    [[...args, '--port', '65536'], '--port'],
    [[...args, '--scenario', 'speak'], 'scenario-not-drivable'],
  ])('refuses invalid arguments before attaching: %j', async (argv, reason) => {
    expect(await runStageCli(argv, context)).toBe(2)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(reason))
    expect(cdp.connect).not.toHaveBeenCalled()
  })

  it.each(['no-mmd-model', 'driver-not-natural', 'measurement-running', 'scenario-not-drivable'])('reports the named %s refusal and closes CDP', async (reason) => {
    if (reason === 'no-mmd-model')
      model = null
    if (reason === 'driver-not-natural')
      driver = 'classic'
    if (reason === 'measurement-running')
      refusal = reason
    const argv = reason === 'scenario-not-drivable' ? [...args, '--scenario', 'walk'] : args
    const run = runStageCli(argv, context)
    await vi.runAllTimersAsync()
    expect(await run).toBe(2)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(reason))
    expect(cdp.close).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a stage the composition lacks', { pose: [...MMD_POSE_STAGE_IDS, 'extra'], surface: [...MMD_SURFACE_STAGE_IDS] }],
    ['a reordered surface list', { pose: [...MMD_POSE_STAGE_IDS], surface: ['morphs', 'body-diagnostics', 'motion-trace'] }],
  ])('refuses a scene whose stage list differs from the shared composition: %s', async (_, stages) => {
    sceneStages = stages
    const run = runStageCli(args, context)
    await vi.runAllTimersAsync()
    expect(await run).toBe(2)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('stage-composition-mismatch'))
    expect(cdp.close).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('requests a stage collection before recording only with --collect-before (%s) and records the choice', async (collect) => {
    const run = runStageCli(collect ? [...args, '--collect-before'] : args, context)
    await vi.runAllTimersAsync()
    expect(await run).toBe(0)
    const collection = cdp.send.mock.calls.findIndex(([method]) => method === 'HeapProfiler.collectGarbage')
    const start = cdp.evaluate.mock.calls.findIndex(([expression]) => String(expression).includes('startTrace'))
    if (collect)
      expect(cdp.send.mock.invocationCallOrder[collection]).toBeLessThan(cdp.evaluate.mock.invocationCallOrder[start])
    else
      expect(collection).toBe(-1)
    expect(JSON.parse(readFileSync(join(dir, 'capture/capture.json'), 'utf8'))).toMatchObject({ collectBefore: collect })
  })

  it('assembles multiple drain chunks, provenance, shot timing and a readable rendered trace', async () => {
    const run = runStageCli(args, context)
    await vi.runAllTimersAsync()
    expect(await run).toBe(0)
    const capture = JSON.parse(readFileSync(join(dir, 'capture/capture.json'), 'utf8'))
    expect(capture).toMatchObject({ frames: 601, valid: true, parity: { stageOrder: 'match' }, shotsPass: 1, shots: [{ at: 0.5, actualAt: 0, file: 'shots/01-0.5s.png' }] })
    const { trace, root } = await readTrace(join(dir, 'capture/trace.json'))
    expect(trace.source).toMatchObject({ level: 'rendered', scenario: { id: 'attach', seed: 7 }, gitSha: expect.stringMatching(/^[a-f0-9]{40}$/), dirty: expect.any(Boolean) })
    expect(root[600 * 4]).toBe(600)
    expect((await new Transformer(readFileSync(join(dir, 'capture/strip.png'))).metadata()).width).toBe(1920)
  })

  it('writes a failed manifest below twenty fps and replays screenshots outside the recording', async () => {
    frameHz = 15
    const run = runStageCli(args, context)
    await vi.runAllTimersAsync()
    expect(await run).toBe(1)
    expect(JSON.parse(readFileSync(join(dir, 'capture/capture.json'), 'utf8'))).toMatchObject({ valid: false, failure: 'frame-rate-under-20', shotsPass: 3 })
  })

  it('replaces a stalled screenshot probe with the trace recorded without screenshots', async () => {
    probeHz = 15
    const run = runStageCli(args, context)
    await vi.runAllTimersAsync()
    expect(await run).toBe(0)
    const capture = JSON.parse(readFileSync(join(dir, 'capture/capture.json'), 'utf8'))
    expect(capture).toMatchObject({ valid: true, probeGapFraction: 1, gapFraction: 0, shotsPass: 3 })
    expect((await readTrace(join(dir, 'capture/trace.json'))).trace.hz).toBeCloseTo(60, 2)
  })
})
