import { NO_WORLD_BODY_INPUT } from '@proj-airi/motion-driver-humanoid/director'
import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { expect, it } from 'vitest'

import { ensureAmmo } from '../../../utils/ammo'
import { createMMDAnimationManager } from '../animation-manager'
import { mmdClipMaskBones } from '../rig/clip-mask'
import { MMDStanceDirector } from '../stance'
import { bodyFixture } from './fixture'

function hold(name: string, bone: string, rotation: Euler, duration = 2) {
  const pose = new Quaternion().setFromEuler(rotation).toArray()
  return new AnimationClip(name, duration, [new QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, [0, duration], [...pose, ...pose])])
}

/** The animation manager, the body and the fixture rig in one real pipeline, as `MMD.vue` composes them. */
async function layeredFixture() {
  const fixture = bodyFixture(0, Math.PI, { arms: true })
  const manager = createMMDAnimationManager(fixture.mmd, { maskBones: mmdClipMaskBones(fixture.rig), physicsEnabled: false })
  const clean: Quaternion[] = []
  manager.pipeline.poseStages.push({ id: 'probe', run: (context) => {
    context.clean.quaternions.forEach((quaternion, index) => (clean[index] ??= new Quaternion()).copy(quaternion))
  } }, ...fixture.body.poseStages)
  manager.pipeline.surfaceStages.push(fixture.body.surfaceStage)
  await manager.init()
  const bind = (name: string, clip: AnimationClip, options: Parameters<typeof manager.registerClip>[2], forceGroups?: Parameters<typeof fixture.body.registerClip>[2]) => {
    manager.registerClip(name, clip, options)
    fixture.body.registerClip(name, clip, forceGroups)
  }
  const cleanOf = (name: string) => clean[fixture.bones.findIndex(bone => bone.name === name)].clone()
  return { ...fixture, manager, bind, cleanOf }
}

it('solves planted ankles with the real MMDIKSolver through the browser frame pipeline', () => {
  const { pipeline, bone, mmd } = bodyFixture()
  // Bone morphs run after the body stages. This unanticipated hip delta must
  // be corrected by the real CCD solver, not merely by the adapter's seed.
  pipeline.poseStages.push({ id: 'bone-morph', run: () => {
    bone('左足').quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.02))
  } })
  let displacement = 0
  for (let frame = 0; frame < 600; frame++) {
    pipeline.step(1 / 30)
    displacement = Math.max(displacement, Math.abs(bone('グルーブ').position.x))
    expect(bone('左足首').getWorldPosition(new Vector3()).distanceTo(new Vector3(1, 1, 0))).toBeLessThan(0.01)
    expect(bone('右足首').getWorldPosition(new Vector3()).distanceTo(new Vector3(-1, 1, 0))).toBeLessThan(0.01)
    expect(mmd.ikSolver.isEnabled(16)).toBe(true)
  }
  expect(displacement).toBeGreaterThan(0.3)
})

it('walks eight units on planted feet while the hair physics feels the travel', async () => {
  const createPhysics = await ensureAmmo()
  const run = (walk: boolean) => {
    const { pipeline, body, mmd, bone, setInput } = bodyFixture(0, Math.PI, { hair: true })
    mmd.setPhysics(createPhysics)
    pipeline.options.physics = true
    setInput({ rootMotion: true })
    // The tip of the hair bone, relative to the head in model axes: root travel alone never moves it.
    const tip = () => mmd.mesh.worldToLocal(bone('髪').localToWorld(new Vector3(0, -1, 0)))
      .sub(mmd.mesh.worldToLocal(bone('頭').getWorldPosition(new Vector3())))
    for (let frame = 0; frame < 120; frame++)
      pipeline.step(1 / 60)
    const rest = tip()
    if (walk)
      body.setLocomotionGoal({ goalX: 8, pace: 'walk', arriveFacing: 0, reason: 'debug' })
    let swing = 0
    let maxError = 0
    for (let frame = 0; frame < 600; frame++) {
      pipeline.step(1 / 60)
      swing = Math.max(swing, tip().distanceTo(rest))
      maxError = Math.max(maxError, body.diagnostics.feet.maxError)
    }
    mmd.dispose()
    return { swing, maxError, locomotion: body.diagnostics.locomotion }
  }
  const still = run(false)
  const walked = run(true)
  expect(walked.locomotion?.mode).toBe('idle')
  expect(Math.abs((walked.locomotion?.position.x ?? 0) - 8)).toBeLessThan(1e-2)
  expect(walked.maxError).toBeLessThan(0.05)
  expect(walked.swing).toBeGreaterThan(0.05)
  expect(walked.swing).toBeGreaterThan(3 * still.swing)
})

it('hangs the arms clear of the torso, hips and skirt on the standing fixture', () => {
  const { pipeline, body } = bodyFixture(0, Math.PI, { arms: true, bodies: true })
  for (let frame = 0; frame < 120; frame++)
    pipeline.step(1 / 60)
  expect(body.diagnostics.arms?.penetration).toEqual({ left: 0, right: 0 })
  expect(body.diagnostics.arms?.clothContact).toEqual({ left: 0, right: 0 })
  expect(body.diagnostics.arms?.handBelowHip).toBe(true)
})

it('keeps the gait enabled and the skate under 0.05 while an upper clip plays over a walk', async () => {
  const { manager, body, bind, setInput, mesh } = await layeredFixture()
  bind('wave', hold('wave', '左腕', new Euler(0, 0, -Math.PI / 3)), { layer: 'upper', split: true, animatedBones: ['左腕'] })
  setInput({ rootMotion: true })
  for (let frame = 0; frame < 30; frame++)
    manager.update(1 / 60)
  body.setLocomotionGoal({ goalX: 8, pace: 'walk', arriveFacing: 0, reason: 'debug' })
  manager.playLayer('wave', { seq: 1, layer: 'upper', loop: true })
  let skate = 0
  let performed = 0
  let walked = false
  for (let frame = 0; frame < 1200 && (!walked || body.diagnostics.locomotion?.mode !== 'idle'); frame++) {
    setInput({ layerClip: manager.snapshot().layer?.name ?? null })
    manager.update(1 / 60)
    const locomotion = body.diagnostics.locomotion
    expect(locomotion?.enabled).toBe(true)
    skate = Math.max(skate, locomotion?.skate ?? Infinity)
    walked ||= locomotion?.mode !== 'idle'
    if (body.performing())
      performed++
  }
  expect(walked).toBe(true)
  expect(performed).toBeGreaterThan(30)
  expect(skate).toBeLessThan(0.05)
  expect(Math.abs(mesh.position.x - 8)).toBeLessThan(1e-2)
})

it('pre-empts the gait for a full clip and issues the walk goal again after it finishes', async () => {
  const { manager, body, bind, setInput, mesh } = await layeredFixture()
  const step = new AnimationClip('step', 0.5, [new VectorKeyframeTrack('.bones[左足ＩＫ].position', [0, 0.5], [0, 0, 0, 0, 0.5, 0])])
  bind('step', step, { layer: 'full' })
  setInput({ rootMotion: true })
  const director = new MMDStanceDirector()
  const request = { seq: 1, clipId: 'step', kind: 'action', layer: 'full', loop: false, durationMs: 500, source: 'tool' } as const
  let atMs = 1_000_000
  let wantRequest = false
  let feedback: { seq: number, state: 'finished' | 'failed' } | null = null
  let playedSeq: number | null = null
  manager.onLayerEvent((event) => {
    if (event.state !== 'playing')
      feedback = { seq: event.seq, state: event.state }
  })
  const frame = (debugGoal: boolean) => {
    atMs += 1000 / 60
    director.update({
      nowMs: atMs,
      performance: { mode: 'idle', attention: 'camera', away: false },
      slots: {},
      idleMotionName: '',
      isRegistered: () => true,
      world: { ...NO_WORLD_BODY_INPUT, ground: { minX: -20, maxX: 20 }, legLength: 1, rootX: mesh.position.x, homeX: 0, locomotionMode: body.locomotionFrame?.mode ?? 'idle', debugGoal: debugGoal ? { seq: 1, x: 8, pace: 'walk' } : null },
      interaction: { interactionSeq: 0, chatSendSeq: 0, interactionAtMs: null, actionRequest: wantRequest ? request : null, actionFeedback: feedback, dragging: false },
    })
    const action = director.intent?.action
    if (action?.phase === 'playing' && playedSeq !== action.seq) {
      playedSeq = action.seq
      manager.playLayer(action.clipId, { seq: action.seq, layer: action.layer, loop: action.loop, kind: 'action' })
    }
    const locomotion = director.intent?.locomotion
    body.setLocomotionGoal(locomotion && locomotion.goalX !== null ? { goalX: locomotion.goalX, pace: locomotion.pace, arriveFacing: locomotion.arriveFacing, reason: locomotion.reason } : null)
    setInput({ layerClip: manager.snapshot().layer?.name ?? null, fullLayerPlaying: action?.phase === 'playing' && action.layer === 'full' })
    manager.update(1 / 60)
  }

  frame(false)
  for (let i = 0; i < 600 && mesh.position.x < 1; i++)
    frame(true)
  expect(mesh.position.x).toBeGreaterThan(1)
  expect(body.locomotionFrame?.mode).not.toBe('idle')

  wantRequest = true
  let playingFrames = 0
  const enabledWhilePlaying: number[] = []
  let pendingSeen = false
  for (let i = 0; i < 1200 && (director.diagnostics.lastActionSeq === 0 || director.diagnostics.performing !== null); i++) {
    frame(true)
    pendingSeen ||= director.diagnostics.pendingGoal !== null
    if (director.diagnostics.performing?.phase === 'playing') {
      playingFrames++
      if (body.diagnostics.locomotion?.enabled !== false)
        enabledWhilePlaying.push(i)
    }
  }
  expect(pendingSeen).toBe(true)
  expect(playingFrames).toBeGreaterThan(0)
  expect(enabledWhilePlaying).toEqual([])
  expect(director.diagnostics.performing).toBeNull()

  for (let i = 0; i < 2400 && Math.abs(mesh.position.x - 8) > 1e-2; i++)
    frame(true)
  expect(Math.abs(mesh.position.x - 8)).toBeLessThan(1e-2)
})

it('leaves the hip on the sit pose and the untouched arm on its base pose while the gesture arm follows the clip', async () => {
  const { manager, bind, cleanOf } = await layeredFixture()
  const sit = new AnimationClip('sit', 2, [
    ...hold('sit', '下半身', new Euler(-Math.PI / 4, 0, 0)).tracks,
    ...hold('sit', '右腕', new Euler(0, 0, Math.PI / 6)).tracks,
    ...hold('sit', '左腕', new Euler(0, 0, Math.PI / 6)).tracks,
  ])
  bind('sit', sit, {})
  bind('wave', hold('wave', '左腕', new Euler(0, 0, -Math.PI / 3)), { layer: 'upper', split: true, animatedBones: ['左腕'] })
  manager.setBaseMotion('sit')
  for (let frame = 0; frame < 120; frame++)
    manager.update(1 / 60)
  const before = { hip: cleanOf('下半身'), right: cleanOf('右腕'), left: cleanOf('左腕') }

  manager.playLayer('wave', { seq: 1, layer: 'upper', loop: true })
  for (let frame = 0; frame < 90; frame++)
    manager.update(1 / 60)
  const during = { hip: cleanOf('下半身'), right: cleanOf('右腕'), left: cleanOf('左腕') }

  expect(during.hip.angleTo(before.hip)).toBeLessThan(1e-3)
  expect(during.right.angleTo(before.right)).toBeLessThan(1e-3)
  expect(during.left.angleTo(before.left)).toBeGreaterThan(0.5)
})
