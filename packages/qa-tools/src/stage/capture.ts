import type { MotionTraceEvent, MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'
import type { MMDMotionSnapshot } from '@proj-airi/stage-ui-mmd/stores'

import type { Motion3dCue } from '../t2-3d/scenarios'
import type { StageMode } from './gates'

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { findDebugTarget, CdpClient as RemoteClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'
import { MMD_POSE_STAGE_IDS, MMD_SURFACE_STAGE_IDS } from '@proj-airi/stage-ui-mmd/composables/mmd/stage-composition'

import { readGitStateFromRepo } from '../evidence/run'
import { parseTrace } from '../t2-3d/read-trace'
import { motion3dScenarios } from '../t2-3d/scenarios'
import { desktopStageTargetPattern, stageTargetPattern } from '../t3/launch'
import { assertStageAnimating, captureStagePng, planScreenshots, untilDeadline } from '../t3/screenshot'
import { CaptureRefusal, captureSnapshot, dismissCaptureNotice, drainCaptureChunk, postCaptureCommand } from './capture-channel'
import { writeCaptureStrip } from './strip'

export interface CaptureOptions {
  repoRoot: string
  port: number
  scenario: string
  seconds: number
  out: string
  mode: StageMode
  shots: number
  seed: number
}

/** The scene must register exactly the shared composition the headless runner uses, or a capture is no evidence for it. */
function assertStageComposition(stages: { pose: readonly string[], surface: readonly string[] }): void {
  const same = (actual: readonly string[], expected: readonly string[]) => actual.length === expected.length && actual.every((id, index) => id === expected[index])
  if (!same(stages.pose, MMD_POSE_STAGE_IDS) || !same(stages.surface, MMD_SURFACE_STAGE_IDS))
    throw new CaptureRefusal('stage-composition-mismatch')
}

function mounted(snapshot: MMDMotionSnapshot | null): MMDMotionSnapshot {
  if (!snapshot?.loadedModelKey || !snapshot.rig)
    throw new CaptureRefusal('no-mmd-model')
  if (snapshot.driver !== 'natural')
    throw new CaptureRefusal('driver-not-natural')
  return snapshot
}

async function driveCue(client: CdpClient, cue: Motion3dCue, snapshot: MMDMotionSnapshot): Promise<void> {
  let event: MotionTraceEvent
  switch (cue.kind) {
    case 'marker':
      event = { t: cue.at, kind: 'marker', label: cue.label }
      break
    case 'goal': {
      if (!snapshot.world || !snapshot.locomotion || !snapshot.rig?.legLength || cue.x === null)
        throw new CaptureRefusal('scenario-not-drivable')
      const x = Math.max(snapshot.world.ground.minX, Math.min(snapshot.world.ground.maxX, snapshot.locomotion.position.x + cue.x * snapshot.rig.legLength))
      await postCaptureCommand(client, { type: 'command', name: 'requestGoal', value: { x, pace: cue.pace } })
      event = { t: cue.at, kind: 'goal', x, pace: cue.pace }
      break
    }
    default:
      throw new CaptureRefusal('scenario-not-drivable')
  }
  await postCaptureCommand(client, { type: 'command', name: 'markTrace', value: event })
}

/** A cue and screenshot timeline on the wall clock; no pose clock or renderer state is advanced by the tool. */
async function captureTimeline(client: CdpClient, options: CaptureOptions, snapshot: MMDMotionSnapshot, cues: readonly Motion3dCue[], shots: boolean) {
  const plans = shots ? planScreenshots(Array.from({ length: options.shots }, (_, index) => (index + 0.5) * options.seconds / options.shots)) : []
  const jobs = [...cues.map(cue => ({ at: cue.at, cue, shot: null })), ...plans.map(shot => ({ at: shot.at, cue: null, shot }))].sort((a, b) => a.at - b.at)
  const pageOrigin = await client.evaluate<number>('performance.now()')
  const origin = performance.now()
  const taken: { at: number, actualAt: number, file: string }[] = []
  for (const job of jobs) {
    await untilDeadline(origin + job.at * 1000, () => performance.now())
    if (job.cue)
      await driveCue(client, job.cue, snapshot)
    if (job.shot) {
      const actualAt = (await client.evaluate<number>('performance.now()') - pageOrigin) / 1000
      await captureStagePng(client, join(options.out, 'shots', job.shot.file))
      taken.push({ ...job.shot, actualAt })
    }
  }
  await untilDeadline(origin + options.seconds * 1000, () => performance.now())
  return taken
}

async function drainRecordedTrace(client: CdpClient, frames: number) {
  if (frames < 2)
    throw new CaptureRefusal('trace-empty')
  const first = await drainCaptureChunk(client, 0, Math.min(600, frames))
  if (!first.header || !first.events)
    throw new CaptureRefusal('trace-header-missing')
  let rot = first.rot
  let root = first.root
  let channels = first.channels
  for (let from = 600; from < frames; from += 600) {
    const chunk = await drainCaptureChunk(client, from, Math.min(600, frames - from))
    rot += chunk.rot
    root += chunk.root
    channels += chunk.channels
  }
  const trace: MotionTraceV1 = { ...first.header, rot, root, channels, events: first.events }
  const decoded = parseTrace(trace)
  const stride = MOTION_TRACE_CHANNELS.length
  const intervals = Array.from({ length: frames - 1 }, (_, index) => decoded.channels[(index + 1) * stride + 1] - decoded.channels[index * stride + 1])
  if (intervals.some(value => !Number.isFinite(value) || value <= 0))
    throw new CaptureRefusal('trace-wall-nonmonotonic')
  const sorted = [...intervals].sort((a, b) => a - b)
  const median = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
  trace.hz = 1 / median
  return { trace, sorted, median, gapFraction: intervals.filter(interval => interval > 1 / 24).length / intervals.length }
}

/** Attaches to an existing app. Its launcher owns the live CPU lease and the isolated display. */
export async function captureStage(options: CaptureOptions) {
  const scenario = motion3dScenarios.find(scenario => scenario.id === options.scenario)
  if (!['idle', 'walk', 'attach'].includes(options.scenario))
    throw new CaptureRefusal('scenario-not-drivable')
  const cues = scenario?.timeline(options.seed, options.seconds) ?? []
  const pattern = options.mode === 'desktop' ? desktopStageTargetPattern : stageTargetPattern
  const target = await findDebugTarget(options.port, `the ${options.mode} stage target`, candidate => candidate.type === 'page' && pattern.test(candidate.url), 120_000)
  if (!target.webSocketDebuggerUrl)
    throw new Error('The stage target has no WebSocket debugger URL')
  const client = await RemoteClient.connect(target.webSocketDebuggerUrl)
  let recording = false
  try {
    mounted((await captureSnapshot(client)).snapshot)
    await assertStageAnimating(client, 10)
    let snapshot = mounted((await captureSnapshot(client, { wait: 'warm' })).snapshot)
    if (options.scenario === 'walk' && (!snapshot.world || !snapshot.locomotion || !snapshot.rig?.legLength))
      throw new CaptureRefusal('scenario-not-drivable')
    const noticeDismissed = await dismissCaptureNotice(client)
    const initial = snapshot
    const prepareReplay = async () => {
      if (options.scenario === 'walk' && initial.locomotion)
        await postCaptureCommand(client, { type: 'command', name: 'requestGoal', value: { x: initial.locomotion.position.x, pace: 'walk' } })
      snapshot = mounted((await captureSnapshot(client, { wait: 'warm' })).snapshot)
    }
    mkdirSync(join(options.out, 'shots'), { recursive: true })
    const record = async (withShots: boolean) => {
      const started = mounted((await captureSnapshot(client, {
        command: { type: 'command', name: 'startTrace', value: { scenario: { id: options.scenario, class: scenario?.class ?? 'idle', seed: options.seed }, maxSeconds: options.seconds } },
        wait: 'recording',
      })).snapshot)
      if (started.trace?.refused)
        throw new CaptureRefusal(started.trace.refused)
      if (started.trace?.state !== 'recording')
        throw new CaptureRefusal('trace-not-recording')
      recording = true
      const shots = await captureTimeline(client, options, snapshot, cues, withShots)
      const stopped = mounted((await captureSnapshot(client, { command: { type: 'command', name: 'stopTrace' }, wait: 'stopped' })).snapshot)
      recording = false
      if (stopped.trace?.refused)
        throw new CaptureRefusal(stopped.trace.refused)
      return { ...await drainRecordedTrace(client, stopped.trace?.frames ?? 0), shots }
    }
    let measured = await record(true)
    assertStageComposition(measured.trace.source.stages)
    const probeGapFraction = measured.gapFraction
    const separateShots = probeGapFraction > 0.005
    let shots = measured.shots
    if (separateShots) {
      await prepareReplay()
      measured = await record(false)
    }
    const { trace, sorted, median, gapFraction } = measured
    trace.source = { ...trace.source, ...readGitStateFromRepo(options.repoRoot), detail: { ...trace.source.detail, seedPolicy: 'cue timeline only; mounted model retains its controller seed' } }
    writeFileSync(join(options.out, 'trace.json'), `${JSON.stringify(trace)}\n`)
    if (separateShots) {
      await prepareReplay()
      shots = await captureTimeline(client, options, snapshot, cues, true)
    }
    const capture = {
      kind: 'stage-capture',
      version: 1,
      scenario: trace.source.scenario,
      seconds: options.seconds,
      mode: options.mode,
      target: target.url,
      frames: trace.frames,
      fps: trace.hz,
      medianFrameIntervalMs: median * 1000,
      worstFrameIntervalMs: sorted[sorted.length - 1] * 1000,
      gapFraction,
      probeGapFraction,
      noticeDismissed,
      shotsPass: separateShots ? 3 : 1,
      shotsNote: separateShots ? 'Discarded the screenshot probe after more than 0.5% of intervals exceeded 1/24 s, recorded again without screenshots, then replayed cues for shots; attach remains undriven.' : 'Shots were taken during the recorded timeline.',
      parity: { stageOrder: 'match', stages: trace.source.stages },
      shots: shots.map(shot => ({ ...shot, file: `shots/${shot.file}` })),
      valid: trace.hz >= 20,
      failure: trace.hz < 20 ? 'frame-rate-under-20' : null,
    }
    writeFileSync(join(options.out, 'capture.json'), `${JSON.stringify(capture, null, 2)}\n`)
    await writeCaptureStrip(capture.shots.map(shot => join(options.out, shot.file)), join(options.out, 'strip.png'))
    return capture
  }
  finally {
    try {
      if (recording)
        await postCaptureCommand(client, { type: 'command', name: 'stopTrace' })
    }
    finally {
      client.close()
    }
  }
}
