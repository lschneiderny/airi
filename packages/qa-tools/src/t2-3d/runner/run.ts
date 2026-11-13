import type { MotionTraceSource, MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { NaturalChatInput } from '@proj-airi/motion-driver-natural/natural-motion'
import type { MMDBodyPoints } from '@proj-airi/stage-ui-mmd/composables/mmd/body/attention'
import type { LayerFade } from '@proj-airi/stage-ui-mmd/composables/mmd/layer-fade'
import type { SkinnedMesh } from 'three'

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
import { LAYER_FADE_SECONDS, stepLayerFade } from '@proj-airi/stage-ui-mmd/composables/mmd/layer-fade'
import { createMMDMotionTraceSampler } from '@proj-airi/stage-ui-mmd/composables/mmd/motion-trace'
import { MMDNaturalAdapter } from '@proj-airi/stage-ui-mmd/composables/mmd/natural/adapter'
import { readMMDRigProfile } from '@proj-airi/stage-ui-mmd/composables/mmd/rig'
import { composeMMDStages } from '@proj-airi/stage-ui-mmd/composables/mmd/stage-composition'
import { directorIdleStates, MMDStanceDirector } from '@proj-airi/stage-ui-mmd/composables/mmd/stance'
import { AnimationMixer, LoopOnce, Matrix4, Quaternion } from 'three'

import * as v from 'valibot'

import { idleDriveDetail, idleMarkerLabel } from '../idle-drive'
import { CLAIM_CLIP_NAME, CLAIM_TRACE_BONES, Motion3dClaimClip } from './claim-clip'
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
  /**
   * `off` sets no idle drive, so Natural's idle scheduler stays inert (the acts-off pair of `qa:motion3d idle-acts`), and
   * is recorded in the trace source as `acts: 'off'`; `on` records nothing, so existing traces stay byte-identical. On a
   * scenario without an idle drive the switch changes nothing but that record.
   */
  readonly acts: 'on' | 'off'
  readonly git: RunGitState
  readonly signal: AbortSignal
  /** Called after each pipeline step with the frame index and the posed mesh; read-only (`qa:motion3d frames` re-runs). */
  readonly onFrame?: (frame: number, mesh: SkinnedMesh) => void
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
    // Set before the first frame, as the app's scene sets it before advancing; the adapter forwards it at that advance.
    const idleDrive = options.acts === 'on' ? options.scenario.idleDrive ?? null : null
    if (idleDrive)
      natural.setIdleDrive({ ...idleDrive.drive })
    const stance = new MMDStanceDirector()
    const sampler = createMMDMotionTraceSampler(mmd, rig, pose)
    sampler.rig.id = modelKey
    sampler.rig.assetSha256 = loaded.assetSha256
    const timeline = options.scenario.timeline(options.seed, options.seconds)
    // A scenario that claims an arm gets one programmatic clip on the runner's mixer, registered like an app clip.
    const claim = timeline.some(cue => cue.kind === 'clip-claim') ? new Motion3dClaimClip(pose, rig, options.seconds) : null
    const claimAction = claim ? mixer.clipAction(claim.clip) : null
    // The claim clip plays as the app's upper layer (animation-manager playLayer, stopLayer): its commands run through
    // the pipeline after the clean pose is restored, so play() captures the clean pose as the mixer's original state,
    // and its weight follows the app's smoothstep layer fade, not three's linear fadeIn.
    let claimFade: LayerFade | null = null
    let claimAmount = 0
    const cues = new Motion3dCueDriver(natural, rig.legLength ?? 0, event => sampler.recorder.event(event), claimAction && {
      claim: () => pipeline?.enqueue(() => {
        claimAction.reset().setLoop(LoopOnce, 1)
        claimAction.clampWhenFinished = true
        claimAction.weight = 0
        claimAction.play()
        claimFade = { from: 0, to: 1, elapsed: 0, duration: LAYER_FADE_SECONDS.upperIn }
      }),
      release: () => pipeline?.enqueue(() => {
        claimFade = { from: claimAmount, to: 0, elapsed: 0, duration: LAYER_FADE_SECONDS.upperOut }
      }),
    })
    const look = new Motion3dLookTarget(mmd.mesh, pose)
    const metrics = new Motion3dMeasurement()
    let points: MMDBodyPoints | null = null
    let cursor: { x: number, y: number } | null = null
    let naturalSeconds = 0
    const body = new MMDBody(mmd, rig, {
      modelKey,
      input: () => ({
        enabled: true,
        rootMotion: true,
        frame: natural.bodyFrame.frame,
        intent: natural.bodyFrame.intent,
        energy: cues.energy,
        stance: stance.intent?.stance,
        rest: stance.intent?.rest,
        points,
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
    body.onEvent(event => sampler.bodyEvent(event))
    if (claim)
      body.registerClip(CLAIM_CLIP_NAME, claim.clip)
    let chat: NaturalChatInput | null = null
    const stages = composeMMDStages({
      body,
      host: {
        'natural': ({ dt }) => {
          natural.advance(dt, {
            performance: cues.performance,
            energy: cues.energy,
            voice: cues.voice,
            cursor,
            chat,
            placement: null,
            emotionStrengths: {},
          }, naturalSeconds)
          for (const report of natural.idleBehaviours)
            sampler.recorder.event({ t: naturalSeconds, kind: 'marker', label: idleMarkerLabel(report) })
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
    if (claim)
      pipeline.registerClip(CLAIM_CLIP_NAME, claim.clip)
    const traceBasis = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(pose.right, pose.up, pose.forward)).invert()
    const detail = {
      ...dependencyVersions(),
      clock: 'director=n*1000/60 ms; Natural=n/60 s; trace wall=motion dt sum',
      hz: 60,
      grant: true,
      ik: true,
      physics: true,
      physicsAffectsIK: mmd.physics?.affectsIK ?? false,
      scenarioVersion: options.scenario.version,
      textureRequests: loaded.textureRequests,
      images: false,
      bones: mmd.pmx.bones.length,
      vertices: mmd.pmx.vertices.length,
      rigidBodies: mmd.pmx.rigidBodies.length,
      joints: mmd.pmx.joints.length,
      ikChains: mmd.pmx.bones.filter(bone => bone.ik).length,
      ...options.acts === 'off' ? { acts: 'off' } : {},
      ...idleDrive ? idleDriveDetail(idleDrive) : {},
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
    const initializedMs = performance.now() - initializedAt
    let nextCue = 0
    let stanceReason: string | null = null
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
      // The camera sits straight ahead of the head at the scenario's look distance, as the app's camera faces her.
      const camera = look.resolve({ x: 0, y: 0 })?.target ?? null
      // The chat panel resolves like a held cursor: Natural takes its head-width point, the body its world point.
      const panel = cues.chat?.target ? look.resolve(cues.chat.target) : null
      chat = cues.chat && panel ? { ...cues.chat, target: panel.cursor } : cues.chat
      points = camera ? { cursor: target?.target ?? null, chat: panel?.target ?? null, camera } : null
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
        idle: directorIdleStates(natural.bodyFrame.intent.idle),
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
      if (options.scenario.recordStance && stance.diagnostics.stanceReason !== stanceReason) {
        stanceReason = stance.diagnostics.stanceReason
        sampler.recorder.event({ t: naturalSeconds, kind: 'marker', label: `stance:${stanceReason}` })
      }
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
      // The animation manager's update: advance the layer fade, set the action and ownership weights, then step.
      if (claimAction && claimFade) {
        const { amount, done } = stepLayerFade(claimFade, Math.min(motion3dStep, 1 / 20))
        claimAmount = amount
        claimAction.weight = amount
        pipeline.clipWeightOverrides.set(CLAIM_CLIP_NAME, amount)
        if (done)
          claimFade = null
        if (done && amount === 0) {
          pipeline.enqueue(() => {
            claimAction.stop()
            pipeline?.clipWeightOverrides.delete(CLAIM_CLIP_NAME)
          })
        }
      }
      pipeline.step(motion3dStep)
      options.onFrame?.(frame, mmd.mesh)
      // Gait is evaluated inside the pose stages; channels must describe this frame.
      if (metrics.scored)
        metrics.sample(body.diagnostics, body.ownership(), claim && claimAction && claimAction.getEffectiveWeight() > 0 ? claim.expected(claimAction.time, traceBasis) : null)
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
      collisions: body.diagnostics.performance?.collision ?? { count: 0, last: null },
      corrector: { ...body.diagnostics.performance?.corrector ?? { capHits: 0, guardScans: 0 }, holds: body.diagnostics.performance?.collision.count ?? 0 },
      clipBones: claim ? CLAIM_TRACE_BONES.map(([, child]) => child) : null,
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
