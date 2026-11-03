import type { MMDUpdateOptions, PhysicsFactory } from '@moeru/three-mmd'
import type { ClipMaskBones } from '@proj-airi/motion-driver-humanoid/clip-mask'
import type { AnimationAction, AnimationMixer } from 'three'

import type { LayerEvent } from './animation-manager'

import { MMD, PmxObject } from '@moeru/three-mmd'
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  LoopOnce,
  MeshBasicMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
} from 'three'
import { describe, expect, it } from 'vitest'

import { createMMDAnimationManager } from './animation-manager'
import { bodyFixture } from './body/fixture'
import { mmdClipMaskBones } from './rig/clip-mask'
import { trackBoneName } from './rig/clip-split'

function createPmx(): PmxObject {
  return {
    bones: [],
    displayFrames: [],
    header: {
      additionalVec4Count: 0,
      boneIndexSize: 4,
      comment: '',
      encoding: PmxObject.Header.Encoding.Utf8,
      englishComment: '',
      englishModelName: '',
      materialIndexSize: 4,
      modelName: '',
      morphIndexSize: 4,
      rigidBodyIndexSize: 4,
      signature: 'PMX',
      textureIndexSize: 4,
      version: 2,
      vertexIndexSize: 4,
    },
    indices: new Uint8Array(),
    joints: [],
    materials: [],
    morphs: [],
    rigidBodies: [],
    softBodies: [],
    textures: [],
    vertices: [],
  }
}

class RecordingMMD extends MMD {
  disposed = false
  gravity = new Vector3()
  mixer?: AnimationMixer
  updates: MMDUpdateOptions[] = []

  constructor(boneNames: string[] = []) {
    const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial())
    mesh.bind(new Skeleton(boneNames.map((name) => {
      const bone = new Bone()
      bone.name = name
      return bone
    })))
    super(createPmx(), mesh)
  }

  override setPhysics(_createPhysics: PhysicsFactory): void {
    this.physics = {
      createHelper: () => {
        throw new Error('No physics helper is used by this test runtime')
      },
      setGravity: gravity => this.gravity.copy(gravity),
      update: () => {},
    }
  }

  override updateAnimation(mixer: AnimationMixer): void {
    this.mixer = mixer
    super.updateAnimation(mixer)
  }

  override beforePhysics(options: MMDUpdateOptions = {}): void {
    this.updates.push({ ...options })
    super.beforePhysics(options)
  }

  override dispose(): void {
    this.disposed = true
    super.dispose()
  }
}

describe('createMMDAnimationManager', () => {
  it('forwards runtime feature gates, gravity, and disposal to MMD', async () => {
    const mmd = new RecordingMMD()
    const manager = createMMDAnimationManager(mmd, { physicsEnabled: false })

    manager.setGravity(3.5)
    manager.setIKEnabled(false)
    await manager.init()
    manager.update(1 / 60)

    expect(mmd.gravity.toArray()).toEqual([0, -3.5, 0])
    expect(mmd.updates).toEqual([
      { grant: true, ik: false, physics: false },
    ])

    manager.setPhysicsEnabled(true)
    manager.setGrantEnabled(false)
    manager.update(1 / 30)

    expect(mmd.updates[1]).toEqual({ grant: false, ik: false, physics: true })

    manager.dispose()
    manager.update(1)

    expect(mmd.disposed).toBe(true)
    expect(mmd.updates).toHaveLength(2)
  })

  it('returns a completed one-shot action to the configured idle motion', async () => {
    const mmd = new RecordingMMD()
    const manager = createMMDAnimationManager(mmd)
    const idle = new AnimationClip('idle', 1, [])
    const gesture = new AnimationClip('gesture', 0.1, [])

    manager.registerClip('idle', idle)
    manager.registerClip('gesture', gesture)
    await manager.init()
    manager.setIdleMotion('idle', 0)
    manager.playAction('gesture', { crossfade: 0 })
    // Four simulation frames cover the one-shot and the queued idle transition.
    for (let frame = 0; frame < 4; frame++)
      manager.update(0.05)

    const idleAction = mmd.mixer?.existingAction(idle)
    const gestureAction = mmd.mixer?.existingAction(gesture)
    expect(idleAction?.isRunning()).toBe(true)
    expect(gestureAction?.isRunning()).toBe(false)
  })
})

const maskBones: ClipMaskBones = { hips: 'センター', leftUpperArm: '左腕', rightUpperArm: '右腕' }
const boneNames = ['センター', '左腕', '右腕']
const rotate = (bone: string, duration: number) => new QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, [0, duration], [0, 0, 0, 1, 0.5, 0, 0, Math.sqrt(0.75)])
const move = (bone: string, duration: number) => new VectorKeyframeTrack(`.bones[${bone}].position`, [0, duration], [0, 0, 0, 0, 1, 0])
const trackBones = (clip: AnimationClip) => clip.tracks.map(track => trackBoneName(track)!).sort()

function axisAngle(axis: 'x' | 'y' | 'z', degrees: number) {
  return new Quaternion().setFromAxisAngle(new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), degrees * Math.PI / 180)
}
const hold = (bone: string, duration: number, pose: Quaternion) => new QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, [0, duration], [...pose.toArray(), ...pose.toArray()])
function degreesBetween(a: Quaternion, b: Quaternion): number {
  return a.angleTo(b) * 180 / Math.PI
}

/** The base holds both arms 40 degrees from the bind pose, far enough that a drift toward bind shows. */
const BASE_POSE = axisAngle('z', 40)
const WAVE_POSE = axisAngle('x', -60)
const WAVE2_POSE = axisAngle('x', 60)
const BIND_POSE = new Quaternion()
const FRAME = 1 / 60

function actionsOf(mmd: RecordingMMD, clipName: string): AnimationAction[] {
  const actions: AnimationAction[] = Reflect.get(mmd.mixer!, '_actions')
  return actions.filter(action => action.getClip().name === clipName)
}

async function layerRig() {
  const mmd = new RecordingMMD(boneNames)
  const manager = createMMDAnimationManager(mmd, { maskBones })
  const events: LayerEvent[] = []
  manager.onLayerEvent(event => events.push(event))
  const baseClip = new AnimationClip('base', 2, [hold('左腕', 2, BASE_POSE), hold('右腕', 2, BASE_POSE), move('センター', 2)])
  manager.registerClip('base', baseClip)
  const gesture = { layer: 'upper', split: true, animatedBones: ['左腕'] } as const
  manager.registerClip('wave', new AnimationClip('wave', 0.5, [hold('左腕', 0.5, WAVE_POSE)]), gesture)
  manager.registerClip('wave2', new AnimationClip('wave2', 0.5, [hold('左腕', 0.5, WAVE2_POSE)]), gesture)
  await manager.init()
  manager.setIdleMotion('base', 0)
  const run = (frames: number, delta = 0.05) => {
    for (let frame = 0; frame < frames; frame++)
      manager.update(delta)
  }
  const arm = (name: '左腕' | '右腕') => mmd.mesh.skeleton.bones.find(bone => bone.name === name)!.quaternion.clone()
  run(2)
  return { mmd, manager, events, run, baseClip, arm }
}

describe('createMMDAnimationManager layers', () => {
  it('registers a clip\'s own upper and lower partitions without listing them as motions or reporting them to the pipeline', async () => {
    const { manager, run } = await layerRig()
    expect(manager.availableClips().sort()).toEqual(['base', 'wave', 'wave2'])
    manager.playLayer('wave', { seq: 1, layer: 'upper', loop: true })
    run(8)
    expect([...manager.pipeline.clean.clipWeights.keys()].sort()).toEqual(['base', 'wave', 'wave2'])
  })

  it('leaves the base identity untouched while an upper layer plays', async () => {
    const { manager, run } = await layerRig()
    const before = manager.snapshot()
    manager.playLayer('wave', { seq: 1, layer: 'upper' })
    run(8)
    expect(manager.snapshot()).toMatchObject({ idle: before.idle, currentAction: before.currentAction, actionsStarted: before.actionsStarted, layer: { seq: 1, name: 'wave', state: 'playing' } })
  })

  it('keeps the base pose on bones the gesture does not animate and moves the animated bone to the gesture', async () => {
    const { manager, run, arm } = await layerRig()
    expect(degreesBetween(arm('右腕'), BIND_POSE)).toBeCloseTo(40, 3)
    manager.playLayer('wave', { seq: 1, layer: 'upper', loop: true })
    let previousDistance = 0
    for (let frame = 1; frame <= 45; frame++) {
      run(1, FRAME)
      // (i) the bone the gesture does not animate stays on the pure base pose and never drifts toward bind.
      expect(degreesBetween(arm('右腕'), BASE_POSE)).toBeLessThan(0.1)
      expect(degreesBetween(arm('右腕'), BIND_POSE)).toBeGreaterThan(39.9)
      // (ii) the animated bone eases monotonically from the base pose to the gesture pose.
      const distance = degreesBetween(arm('左腕'), BASE_POSE)
      expect(distance).toBeGreaterThanOrEqual(previousDistance - 1e-6)
      previousDistance = distance
    }
    expect(degreesBetween(arm('左腕'), WAVE_POSE)).toBeLessThan(0.5)
  })

  it('splits the base by the gesture\'s animated bones', async () => {
    const { mmd, manager, run } = await layerRig()
    manager.playLayer('wave', { seq: 1, layer: 'upper', loop: true })
    run(11)
    const [yielded] = actionsOf(mmd, 'base#yield(wave)')
    const [kept] = actionsOf(mmd, 'base#keep(wave)')
    expect(trackBones(yielded!.getClip())).toEqual(['左腕'])
    expect(trackBones(kept!.getClip())).toEqual(['センター', '右腕'])
    expect(kept!.time).toBeCloseTo(yielded!.time, 6)
  })

  it('reports the nominal weights of the base and the gesture to the pipeline while partitions play', async () => {
    const { manager, run } = await layerRig()
    manager.playLayer('wave', { seq: 1, layer: 'upper', loop: true })
    run(8)
    expect(manager.pipeline.clean.clipWeights.get('base')).toBe(1)
    expect(manager.pipeline.clean.clipWeights.get('wave')).toBeCloseTo(1, 6)
  })

  it('finishes once and restores the full base pose when the layer ends', async () => {
    const { mmd, manager, events, run, baseClip, arm } = await layerRig()
    manager.playLayer('wave', { seq: 1, layer: 'upper' })
    run(120, FRAME)
    expect(events).toEqual([{ seq: 1, state: 'playing' }, { seq: 1, state: 'finished' }])
    expect(manager.snapshot().layer).toBeNull()
    for (const name of ['base#yield(wave)', 'base#keep(wave)', 'wave#upper'])
      expect(actionsOf(mmd, name).every(action => !action.isScheduled())).toBe(true)
    // (iii) both arms are back on the pure base pose, with the base one running action again.
    expect(degreesBetween(arm('左腕'), BASE_POSE)).toBeLessThan(0.1)
    expect(degreesBetween(arm('右腕'), BASE_POSE)).toBeLessThan(0.1)
    const base = mmd.mixer!.existingAction(baseClip)!
    expect([base.enabled, base.isRunning(), base.weight, base.getEffectiveWeight()]).toEqual([true, true, 1, 1])
  })

  it('reports failed for a replaced layer and for a layer stopped before it finished', async () => {
    const { manager, events, run } = await layerRig()
    manager.playLayer('wave', { seq: 1, layer: 'upper', loop: true })
    run(8)
    manager.playLayer('wave', { seq: 2, layer: 'upper', loop: true })
    run(8)
    manager.stopLayer(2)
    run(10)
    expect(events).toEqual([
      { seq: 1, state: 'playing' },
      { seq: 1, state: 'failed' },
      { seq: 2, state: 'playing' },
      { seq: 2, state: 'failed' },
    ])
    expect(manager.snapshot().layer).toBeNull()
    expect(manager.playLayer('missing', { seq: 3, layer: 'full' })).toBe(false)
    expect(events.at(-1)).toEqual({ seq: 3, state: 'failed' })
  })

  it('crossfades a replaced layer instead of snapping the arm', async () => {
    const { manager, events, run, arm } = await layerRig()
    manager.playLayer('wave', { seq: 1, layer: 'upper', loop: true })
    run(30, FRAME)
    expect(degreesBetween(arm('左腕'), WAVE_POSE)).toBeLessThan(0.5)
    manager.playLayer('wave2', { seq: 2, layer: 'upper', loop: true })
    let previous = arm('左腕')
    let largestStep = 0
    for (let frame = 0; frame < 60; frame++) {
      run(1, FRAME)
      const current = arm('左腕')
      largestStep = Math.max(largestStep, degreesBetween(current, previous))
      previous = current
      expect(degreesBetween(arm('右腕'), BASE_POSE)).toBeLessThan(0.1)
    }
    expect(largestStep).toBeLessThan(25)
    expect(degreesBetween(arm('左腕'), WAVE2_POSE)).toBeLessThan(0.5)
    expect(events).toContainEqual({ seq: 1, state: 'failed' })
    expect(events.filter(event => event.seq === 1 && event.state === 'failed')).toHaveLength(1)
    expect(manager.snapshot().layer).toMatchObject({ seq: 2, name: 'wave2' })
  })

  it('crossfades a layer replaced by the same clip without snapping either', async () => {
    const { manager, run, arm } = await layerRig()
    manager.playLayer('wave', { seq: 1, layer: 'upper', loop: true })
    run(30, FRAME)
    manager.playLayer('wave', { seq: 2, layer: 'upper', loop: true })
    let previous = arm('左腕')
    for (let frame = 0; frame < 60; frame++) {
      run(1, FRAME)
      const current = arm('左腕')
      expect(degreesBetween(current, previous)).toBeLessThan(25)
      previous = current
    }
    manager.stopLayer(2)
    run(60, FRAME)
    expect(manager.snapshot().layer).toBeNull()
    expect(degreesBetween(arm('左腕'), BASE_POSE)).toBeLessThan(0.1)
  })

  it('plays a dance once even when asked to loop, and says so in the event', async () => {
    const { mmd, manager, events, run } = await layerRig()
    manager.registerClip('dance', new AnimationClip('dance', 1, [rotate('左腕', 1), move('センター', 1)]))
    manager.playLayer('dance', { seq: 4, layer: 'full', loop: true, kind: 'dance' })
    run(4)
    expect(actionsOf(mmd, 'dance')[0]!.loop).toBe(LoopOnce)
    expect(events[0]).toEqual({ seq: 4, state: 'playing', notes: ['loop-ignored'] })
  })

  it('takes over every bone a full layer keys and leaves the others on the base', async () => {
    const { mmd, manager, run, arm } = await layerRig()
    manager.registerClip('dance', new AnimationClip('dance', 1, [rotate('左腕', 1), move('センター', 1)]))
    manager.playLayer('dance', { seq: 5, layer: 'full', kind: 'dance' })
    run(16)
    expect(trackBones(actionsOf(mmd, 'base#yield(dance)')[0]!.getClip())).toEqual(['センター', '左腕'])
    expect(trackBones(actionsOf(mmd, 'base#keep(dance)')[0]!.getClip())).toEqual(['右腕'])
    expect(degreesBetween(arm('右腕'), BASE_POSE)).toBeLessThan(0.1)
  })

  it('re-partitions a swapped base during a layer so no partition of the old base keeps playing', async () => {
    const { mmd, manager, run } = await layerRig()
    const walkClip = new AnimationClip('walk', 2, [hold('左腕', 2, BASE_POSE), move('センター', 2)])
    manager.registerClip('walk', walkClip)
    manager.playLayer('wave', { seq: 1, layer: 'upper', loop: true })
    run(8)
    manager.setBaseMotion('walk', 0.2)
    run(10)
    expect(manager.snapshot().idle).toBe('walk')
    const live = (name: string) => actionsOf(mmd, name).filter(action => action.isScheduled())
    expect(live('base#keep(wave)')).toHaveLength(0)
    expect(live('base#yield(wave)')).toHaveLength(0)
    expect(trackBones(live('walk#keep(wave)')[0]!.getClip())).toEqual(['センター'])
    expect(live('walk#keep(wave)')[0]!.weight).toBe(1)
    expect(live('walk#yield(wave)')[0]!.weight).toBeCloseTo(0, 6)
    manager.stopLayer(1)
    run(10)
    const walk = mmd.mixer!.existingAction(walkClip)!
    expect([walk.enabled, walk.isRunning(), walk.weight]).toEqual([true, true, 1])
    expect(live('walk#keep(wave)')).toHaveLength(0)
  })

  it('does not play partitions cut from a clip that was re-registered', async () => {
    const { mmd, manager, run } = await layerRig()
    manager.playLayer('wave', { seq: 1, layer: 'upper' })
    run(40)
    manager.registerClip('base', new AnimationClip('base', 2, [rotate('左腕', 2), move('センター', 2)]))
    manager.setBaseMotion('base', 0)
    run(2)
    manager.playLayer('wave', { seq: 2, layer: 'upper', loop: true })
    run(10)
    const keeps = actionsOf(mmd, 'base#keep(wave)').filter(action => action.isScheduled())
    expect(keeps).toHaveLength(1)
    expect(trackBones(keeps[0]!.getClip())).toEqual(['センター'])
  })

  it('keeps the gait on and the root unowned while a real body sees an upper layer over its base', async () => {
    const fixture = bodyFixture(0, Math.PI, { arms: true })
    const { mmd, body, rig, setInput } = fixture
    setInput({ rootMotion: true })
    const manager = createMMDAnimationManager(mmd, { maskBones: mmdClipMaskBones(rig), physicsEnabled: false })
    manager.pipeline.poseStages.push(...body.poseStages)
    const idle = new AnimationClip('idle', 2, [hold('左腕', 2, BASE_POSE), hold('右腕', 2, BASE_POSE)])
    const wave = new AnimationClip('wave', 0.5, [hold('左腕', 0.5, WAVE_POSE)])
    manager.registerClip('idle', idle)
    manager.registerClip('wave', wave, { layer: 'upper', split: true, animatedBones: ['左腕'] })
    // The scene registers real clip names with the body and nothing else.
    body.registerClip('idle', idle)
    body.registerClip('wave', wave)
    await manager.init()
    manager.setIdleMotion('idle', 0)
    for (let frame = 0; frame < 4; frame++)
      manager.update(FRAME)
    manager.playLayer('wave', { seq: 1, layer: 'upper', loop: true })
    for (let frame = 0; frame < 40; frame++) {
      manager.update(FRAME)
      const owned = body.ownership()
      expect([owned.root, owned.leftLegIk, owned.rightLegIk]).toEqual([0, 0, 0])
      expect(body.diagnostics.locomotion?.enabled).toBe(true)
    }
    expect(body.ownership().leftArm).toBeGreaterThan(0)
  })
})
