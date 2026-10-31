import type { MMD, MMDUpdateOptions } from '@moeru/three-mmd'
import type { AnimationClip, AnimationMixer, Quaternion, Vector3 } from 'three'

import { MMDFrameMetrics } from './frame-metrics'

/** Reused buffers: only the pipeline writes these, stages read them synchronously. */
export interface MMDCleanPose {
  readonly positions: readonly Vector3[]
  readonly quaternions: readonly Quaternion[]
  readonly morphs: readonly number[]
  readonly clipWeights: ReadonlyMap<string, number>
}

export interface MMDFrameContext {
  readonly dt: number
  readonly mmd: MMD
  readonly mixer: AnimationMixer
  readonly clean: MMDCleanPose
}

export interface MMDFrameStage {
  readonly id: string
  readonly run: (context: MMDFrameContext) => void
}

/**
 * Owns the boundary between mixer output and procedural/solver output.
 * Commands are deferred until the clean pose is restored, including play()'s
 * PropertyMixer original-state capture. No pose stage can contaminate a fade.
 */
export class MMDFramePipeline {
  readonly poseStages: MMDFrameStage[]
  readonly surfaceStages: MMDFrameStage[]
  readonly options: MMDUpdateOptions = { grant: true, ik: true, physics: true }
  readonly clipFootIK = new Map<string, { left: boolean, right: boolean }>()
  readonly metrics: MMDFrameMetrics
  private readonly mmd: MMD
  private readonly mixer: AnimationMixer
  private readonly commands: Array<() => void> = []
  private readonly clips = new Map<string, AnimationClip>()
  private readonly positions: Vector3[]
  private readonly quaternions: Quaternion[]
  private readonly morphs: number[]
  private readonly clipWeights = new Map<string, number>()
  readonly clean: MMDCleanPose
  private resetPhysics = false
  private readonly onLoop = () => {
    this.resetPhysics = true
  }

  constructor({ mmd, mixer, poseStages = [], surfaceStages = [], metrics = new MMDFrameMetrics() }: {
    mmd: MMD
    mixer: AnimationMixer
    poseStages?: MMDFrameStage[]
    surfaceStages?: MMDFrameStage[]
    metrics?: MMDFrameMetrics
  }) {
    this.mmd = mmd
    this.mixer = mixer
    this.poseStages = poseStages
    this.surfaceStages = surfaceStages
    this.metrics = metrics
    this.positions = mmd.mesh.skeleton.bones.map(bone => bone.position.clone())
    this.quaternions = mmd.mesh.skeleton.bones.map(bone => bone.quaternion.clone())
    this.morphs = [...(mmd.mesh.morphTargetInfluences ?? [])]
    this.clean = { positions: this.positions, quaternions: this.quaternions, morphs: this.morphs, clipWeights: this.clipWeights }
    mixer.addEventListener('loop', this.onLoop)
  }

  enqueue(command: () => void): void {
    this.commands.push(command)
  }

  registerClip(name: string, clip: AnimationClip): void {
    this.clips.set(name, clip)
    this.clipFootIK.set(name, {
      left: clip.tracks.some(track => track.name === '.bones[左足ＩＫ].position'),
      right: clip.tracks.some(track => track.name === '.bones[右足ＩＫ].position'),
    })
  }

  requestPhysicsReset(): void {
    this.resetPhysics = true
  }

  step(delta: number): void {
    const dt = Math.min(delta, 1 / 20)
    const { mmd, mixer } = this
    const context: MMDFrameContext = { dt, mmd, mixer, clean: this.clean }
    this.metrics.measure('beforeUpdate', () => mmd.beforeUpdate())
    this.metrics.measure('restore', () => {
      mmd.mesh.skeleton.bones.forEach((bone, i) => {
        bone.position.copy(this.positions[i])
        bone.quaternion.copy(this.quaternions[i])
      })
      mmd.mesh.morphTargetInfluences?.fill(0)
      // NOTICE:
      // Restore clip-only morph values after clearing procedural output.
      // PropertyMixer skips writes when consecutive samples have equal values.
      // Source: three/src/animation/PropertyMixer.js, apply().
      // Remove when the mixer supports forcing unchanged morph bindings to write.
      this.morphs.forEach((value, i) => {
        if (mmd.mesh.morphTargetInfluences)
          mmd.mesh.morphTargetInfluences[i] = value
      })
    })
    this.metrics.measure('commands', () => {
      // Commands enqueued by mixer events belong to the next clean frame.
      const count = this.commands.length
      for (let i = 0; i < count; i++)
        this.commands[i]()
      this.commands.splice(0, count)
    })
    this.metrics.measure('mixer.update', () => mixer.update(dt))
    this.metrics.measure('updateAnimation', () => mmd.updateAnimation(mixer))
    this.metrics.measure('capture', () => {
      mmd.mesh.skeleton.bones.forEach((bone, i) => {
        this.positions[i].copy(bone.position)
        this.quaternions[i].copy(bone.quaternion)
      })
      mmd.mesh.morphTargetInfluences?.forEach((value, i) => {
        this.morphs[i] = value
      })
      for (const [name, clip] of this.clips) {
        const action = mixer.existingAction(clip)
        this.clipWeights.set(name, action?.isScheduled() ? action.getEffectiveWeight() : 0)
      }
    })
    for (const stage of this.poseStages)
      this.metrics.measure(stage.id, () => stage.run(context))
    this.metrics.measure('beforePhysics', () => mmd.beforePhysics(this.options))
    this.metrics.measure('physics.reset', () => {
      if (this.resetPhysics) {
        mmd.physics?.reset?.()
        this.resetPhysics = false
      }
    })
    this.metrics.measure('physics.update', () => {
      if (this.options.physics !== false)
        mmd.physics?.update(dt)
    })
    this.metrics.measure('afterPhysics', () => mmd.afterPhysics(this.options))
    for (const stage of this.surfaceStages)
      this.metrics.measure(stage.id, () => stage.run(context))
  }

  timings() {
    return this.metrics.timings()
  }

  dispose(): void {
    this.mixer.removeEventListener('loop', this.onLoop)
    this.commands.length = 0
    this.poseStages.length = 0
    this.surfaceStages.length = 0
    this.clips.clear()
    this.clipFootIK.clear()
    this.clipWeights.clear()
  }
}
