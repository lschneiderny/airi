import type { MotionTraceSource, MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { RunGitState } from '../../evidence/run'
import type { Motion3dScenario } from '../scenarios'

import process from 'node:process'

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { setImmediate } from 'node:timers/promises'

import { NO_WORLD_BODY_INPUT } from '@proj-airi/motion-driver-humanoid/director'
import { MOTION_TRACE_KIND, MOTION_TRACE_VERSION } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { MMDBody } from '@proj-airi/stage-ui-mmd/composables/mmd/body'
import { resolveBodyTarget } from '@proj-airi/stage-ui-mmd/composables/mmd/body/attention'
import { MMDBodyPose } from '@proj-airi/stage-ui-mmd/composables/mmd/body/pose'
import { MMDFramePipeline } from '@proj-airi/stage-ui-mmd/composables/mmd/frame-pipeline'
import { createMMDMotionTraceSampler, mmdBodyTraceEvent } from '@proj-airi/stage-ui-mmd/composables/mmd/motion-trace'
import { MMDNaturalAdapter } from '@proj-airi/stage-ui-mmd/composables/mmd/natural/adapter'
import { readMMDRigProfile } from '@proj-airi/stage-ui-mmd/composables/mmd/rig'
import { composeMMDStages } from '@proj-airi/stage-ui-mmd/composables/mmd/stage-composition'
import { MMDStanceDirector } from '@proj-airi/stage-ui-mmd/composables/mmd/stance'
import { AnimationMixer, Matrix4, Quaternion } from 'three'

import * as v from 'valibot'

import { Motion3dCueDriver } from './cues'
import { loadHeadlessMMD } from './loader'
import { Motion3dLookTarget } from './look-target'
import { Motion3dMeasurement } from './measurement'

export const motion3dStep = 1 / 60
/** Production work this level does not run; their stages keep their slots in the shared composition and do nothing. */
const omitted = ['classic-gaze', 'classic-face', 'lip-sync', 'bone-morphs', 'morphs', 'natural-face', 'touch-colliders', 'overlays', 'clip-layers', 'images', 'render']
const modes = { idle: 0, turning: 1, starting: 2, walking: 3, stopping: 4 } as const

export interface Motion3dRunOptions {
  readonly model: string
  readonly scenario: Motion3dScenario
  readonly seed: number
  readonly seconds: number
  readonly warmupSeconds: number
  readonly git: RunGitState
  readonly signal: AbortSignal
}

function dependencyVersions() {
  const require = createRequire(import.meta.url)
  const version = (path: string) => v.parse(v.object({ version: v.string() }), JSON.parse(readFileSync(path, 'utf8'))).version
  return {
    three: version(resolve(dirname(require.resolve('three')), '../package.json')),
    threeMmd: version(require.resolve('@moeru/three-mmd/package.json')),
    threeMmdPhysicsAmmo: version(require.resolve('@moeru/three-mmd-physics-ammo/package.json')),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  }
}

/** Each call owns a fresh model, Ammo world, clocks, controllers and recorder. */
export async function runMotion3dScenario(options: Motion3dRunOptions) {
  options.signal.throwIfAborted()
  const initializedAt = performance.now()
  const loaded = await loadHeadlessMMD(options.model)
  const { mmd } = loaded
  let pipeline: MMDFramePipeline | undefined
  const mixer = new AnimationMixer(mmd.mesh)
  try {
    const modelKey = `qa-${options.seed}`
    const rig = readMMDRigProfile(mmd.pmx)
    const pose = new MMDBodyPose(mmd, rig)
    const natural = new MMDNaturalAdapter(modelKey)
    const stance = new MMDStanceDirector()
    const sampler = createMMDMotionTraceSampler(mmd, rig, pose)
    sampler.rig.id = modelKey
    sampler.rig.assetSha256 = loaded.assetSha256
    const cues = new Motion3dCueDriver(natural, rig.legLength ?? 0, event => sampler.recorder.event(event))
    const look = new Motion3dLookTarget(mmd.mesh, pose)
    const metrics = new Motion3dMeasurement()
    let points: Parameters<typeof resolveBodyTarget>[0] = null
    let cursor: { x: number, y: number } | null = null
    let naturalSeconds = 0
    const body = new MMDBody(mmd, rig, {
      modelKey,
      input: () => ({
        enabled: true,
        rootMotion: true,
        frame: natural.bodyFrame.frame,
        intent: natural.bodyFrame.intent,
        energy: 0.5,
        stance: stance.intent?.stance,
        target: resolveBodyTarget(points, natural.bodyFrame, 'mouse', stance.intent),
        disableFootContact: false,
        disableLookAt: false,
        stanceClips: stance.baseClips,
        dragging: false,
      }),
      root: { setPose: (x, yaw) => {
        mmd.mesh.position.x = x
        mmd.mesh.rotation.y = yaw
        mmd.mesh.updateMatrixWorld(true)
      } },
    })
    let motionTime = 0
    body.onEvent(event => sampler.recorder.event(mmdBodyTraceEvent(event, motionTime)))
    const stages = composeMMDStages({
      body,
      host: {
        'natural': ({ dt }) => {
          natural.advance(dt, {
            performance: cues.performance,
            energy: 0.5,
            voice: cues.voice,
            cursor,
            chat: null,
            placement: null,
            emotionStrengths: {},
          }, naturalSeconds)
        },
        'motion-trace': (context) => {
          const gait = body.locomotionFrame
          sampler.inputs.channels.locomotionMode = gait ? modes[gait.mode] : 0
          sampler.inputs.channels.gaitWeight = gait?.weight ?? 0
          sampler.stage.run(context)
        },
      },
    })
    pipeline = new MMDFramePipeline({ mmd, mixer, metrics, poseStages: stages.pose, surfaceStages: stages.surface })
    const traceBasis = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(pose.right, pose.up, pose.forward)).invert()
    const detail = {
      ...dependencyVersions(),
      clock: 'director=n*1000/60 ms; Natural=n/60 s; trace wall=motion dt sum',
      hz: 60,
      grant: true,
      ik: true,
      physics: true,
      physicsAffectsIK: mmd.physics?.affectsIK ?? false,
      textureRequests: loaded.textureRequests,
      images: false,
      bones: mmd.pmx.bones.length,
      vertices: mmd.pmx.vertices.length,
      rigidBodies: mmd.pmx.rigidBodies.length,
      joints: mmd.pmx.joints.length,
      ikChains: mmd.pmx.bones.filter(bone => bone.ik).length,
    }
    const source: MotionTraceSource = {
      level: 't2-3d',
      scenario: { id: options.scenario.id, class: options.scenario.class, seed: options.seed },
      gitSha: options.git.gitSha,
      dirty: options.git.dirty,
      stages: { pose: pipeline.poseStages.map(stage => stage.id), surface: pipeline.surfaceStages.map(stage => stage.id) },
      omitted,
      detail,
    }
    const warmupFrames = Math.round(options.warmupSeconds * 60)
    const frames = Math.round((options.warmupSeconds + options.seconds) * 60)
    sampler.recorder.start({
      kind: MOTION_TRACE_KIND,
      version: MOTION_TRACE_VERSION,
      source,
      rig: sampler.rig,
      hz: 60,
      scoredFrom: warmupFrames / 60,
    })
    const timeline = options.scenario.timeline(options.seed, options.seconds)
    const initializedMs = performance.now() - initializedAt
    let nextCue = 0
    const started = performance.now()
    for (let frame = 0; frame < frames; frame++) {
      // Yield for interrupts and the CPU lease heartbeat without advancing pose clocks.
      if (frame % 60 === 0)
        await setImmediate(undefined, { signal: options.signal })
      naturalSeconds = frame / 60
      const scoredTime = naturalSeconds - options.warmupSeconds
      while (nextCue < timeline.length && timeline[nextCue].at <= scoredTime + 1e-9)
        cues.apply(timeline[nextCue++], naturalSeconds)
      cues.step(naturalSeconds)
      const target = look.resolve(cues.cursor)
      points = target ? { cursor: target.target, chat: null, camera: target.target } : null
      cursor = target?.cursor ?? null
      if (cues.goalCancelled) {
        stance.clearGoal()
        cues.goalCancelled = false
      }
      stance.update({
        nowMs: frame * 1000 / 60,
        performance: cues.performance,
        slots: {},
        idleMotionName: '',
        isRegistered: () => false,
        points: points ?? undefined,
        interaction: { interactionSeq: 0, chatSendSeq: 0, interactionAtMs: null, actionRequest: null, actionFeedback: null, dragging: false },
        world: {
          ...NO_WORLD_BODY_INPUT,
          ground: rig.legLength ? { minX: -60 * rig.legLength, maxX: 60 * rig.legLength } : null,
          rootX: mmd.mesh.position.x,
          locomotionMode: body.diagnostics.locomotion?.mode ?? 'idle',
          speaking: cues.voice.speaking,
          cursorX: points?.cursor?.x ?? null,
          cursorOnStage: points?.cursor != null,
          debugGoal: cues.debugGoal,
          legLength: rig.legLength ?? 0,
          seed: options.seed,
        },
      })
      body.setLocomotionGoal(stance.intent?.locomotion ?? null)
      motionTime = frame === 0 ? 0 : motionTime + motion3dStep
      sampler.inputs.wall = motionTime
      const targetPoint = resolveBodyTarget(points, natural.bodyFrame, 'mouse', stance.intent)?.applyQuaternion(traceBasis)
      sampler.inputs.channels = {
        voiceLevel: cues.voice.level,
        speaking: cues.voice.speaking ? 1 : 0,
        targetX: targetPoint?.x ?? Number.NaN,
        targetY: targetPoint?.y ?? Number.NaN,
        targetZ: targetPoint?.z ?? Number.NaN,
      }
      metrics.scored = frame >= warmupFrames
      pipeline.step(motion3dStep)
      // Gait is evaluated inside the pose stages; channels must describe this frame.
      if (metrics.scored)
        metrics.sample(body.diagnostics)
    }
    const wallMs = performance.now() - started
    sampler.recorder.stop()
    const drained = sampler.recorder.drain()
    if (!drained.header || !drained.events)
      throw new TypeError('Full motion trace drain must include its header and events')
    const trace: MotionTraceV1 = { ...drained.header, rot: drained.rot, root: drained.root, channels: drained.channels, events: drained.events }
    const summary = metrics.finish({
      model: modelKey,
      scenario: { ...source.scenario, seed: options.seed, seconds: options.seconds, warmupSeconds: options.warmupSeconds },
      provenance: { ...detail, assetSha256: loaded.assetSha256, gitSha: options.git.gitSha, dirty: options.git.dirty, initializedMs, omitted: omitted.join(',') },
      poseStages: source.stages.pose,
      wallMs,
      simulatedSeconds: frames / 60,
    })
    return { trace, summary }
  }
  finally {
    pipeline?.dispose()
    mixer.stopAllAction()
    mixer.uncacheRoot(mmd.mesh)
    loaded.dispose()
  }
}
