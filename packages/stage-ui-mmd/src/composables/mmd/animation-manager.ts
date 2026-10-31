import type { MMD } from '@moeru/three-mmd'
import type { AnimationAction, AnimationClip } from 'three'

import { AnimationMixer, LoopOnce, LoopRepeat, Vector3 } from 'three'

import { ensureAmmo } from '../../utils/ammo'
import { MMDFramePipeline } from './frame-pipeline'

const DEFAULT_CROSSFADE = 0.4
/** Cross-fade, in seconds, between looping base clips when the stance changes. */
export const BASE_CROSSFADE = 0.6

export interface MMDAnimationManagerOptions {
  /**
   * Initial physics enablement. Ammo is still installed so physics can be
   * enabled later without rebuilding the model runtime.
   *
   * @default true
   */
  physicsEnabled?: boolean
}

export interface PlayActionOptions {
  /**
   * Loop the action instead of reverting to idle when it finishes.
   *
   * @default false
   */
  loop?: boolean
  /**
   * Cross-fade duration in seconds.
   *
   * @default 0.4
   */
  crossfade?: number
}

/**
 * Owns a model's animation mixer, imported VMD catalog, solver feature gates,
 * and lazily installed Ammo runtime.
 *
 * `update(delta)` runs the pipeline's registered pose and surface stages.
 * Disposal stops actions before ending
 * the MMD runtime so no frame can observe a partially torn-down model.
 */
export function createMMDAnimationManager(mmd: MMD, options: MMDAnimationManagerOptions = {}) {
  const mixer = new AnimationMixer(mmd.mesh)
  const pipeline = new MMDFramePipeline({ mmd, mixer })
  const registry = new Map<string, AnimationClip>()
  const finishListeners = new Map<AnimationAction, (event: { action: AnimationAction }) => void>()
  const baseFades = new Map<AnimationAction, { from: number, to: number, elapsed: number, duration: number }>()

  let idleAction: AnimationAction | undefined
  let currentAction: AnimationAction | undefined
  let initialized = false
  let disposed = false
  let initialization: Promise<void> | undefined
  pipeline.options.physics = options.physicsEnabled ?? true
  let gravity: number | undefined
  let actionsStarted = 0

  function removeFinishListener(action: AnimationAction): void {
    const listener = finishListeners.get(action)
    if (!listener)
      return
    mixer.removeEventListener('finished', listener)
    finishListeners.delete(action)
  }

  function revertToIdleOnFinish(action: AnimationAction): void {
    removeFinishListener(action)
    const onFinished = (event: { action: AnimationAction }) => {
      if (event.action !== action)
        return
      removeFinishListener(action)
      playIdle()
    }
    finishListeners.set(action, onFinished)
    mixer.addEventListener('finished', onFinished)
  }

  /**
   * Installs the lazy Ammo backend and optionally starts an initial idle clip.
   * Concurrent calls share one initialization; disposal while Ammo loads
   * prevents the completed promise from reviving the manager.
   */
  async function init(idle?: AnimationClip): Promise<void> {
    if (initialized || disposed)
      return
    if (initialization)
      return initialization

    initialization = (async () => {
      const createPhysics = await ensureAmmo()
      if (disposed)
        return

      mmd.setPhysics(createPhysics)
      if (gravity !== undefined)
        mmd.physics?.setGravity?.(new Vector3(0, -gravity, 0))

      if (idle) {
        registerClip(idle.name, idle)
        setIdleMotion(idle.name, 0)
      }
      initialized = true
    })()

    return initialization
  }

  /** Registers a VMD-derived clip under a name for later playback. */
  function registerClip(name: string, clip: AnimationClip): void {
    registry.set(name, clip)
    pipeline.registerClip(name, clip)
  }

  /** Names of all registered motions, for settings UIs and action mapping. */
  function availableClips(): string[] {
    return Array.from(registry.keys())
  }

  /** Cross-fades back to the persistent idle loop. */
  function playIdle(crossfade = DEFAULT_CROSSFADE): void {
    pipeline.enqueue(() => applyIdle(crossfade))
  }

  function applyIdle(crossfade: number): void {
    if (currentAction)
      removeFinishListener(currentAction)

    // With no configured idle, fade the active motion out so the skeleton
    // returns to its rest pose instead of clamping on the final keyframe.
    if (!idleAction) {
      currentAction?.fadeOut(crossfade)
      currentAction = undefined
      return
    }

    if (currentAction && currentAction !== idleAction)
      currentAction.fadeOut(crossfade)
    // A one-shot may reuse the same action, so restore its looping contract.
    idleAction.reset().setLoop(LoopRepeat, Number.POSITIVE_INFINITY).setEffectiveWeight(1).fadeIn(crossfade).play()
    currentAction = idleAction
  }

  /**
   * Plays a registered motion and cross-fades from the current action.
   * One-shots return to idle; looping actions remain active until replaced.
   *
   * @returns `false` when no clip is registered under `name`.
   */
  function playAction(name: string, actionOptions: PlayActionOptions = {}): boolean {
    const clip = registry.get(name)
    if (!clip) {
      console.warn(`[mmd] playAction skipped: "${name}" is not registered`)
      return false
    }

    pipeline.enqueue(() => {
      const loop = actionOptions.loop ?? false
      const crossfade = actionOptions.crossfade ?? DEFAULT_CROSSFADE
      const action = mixer.clipAction(clip)
      action.reset()
      action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Number.POSITIVE_INFINITY : 1)
      action.clampWhenFinished = !loop
      action.setEffectiveWeight(1)
      action.fadeIn(crossfade).play()

      if (currentAction && currentAction !== action) {
        removeFinishListener(currentAction)
        currentAction.fadeOut(crossfade)
      }
      currentAction = action
      actionsStarted++

      if (loop)
        removeFinishListener(action)
      else
        revertToIdleOnFinish(action)
    })

    return true
  }

  /**
   * Makes a registered motion the looping base that one-shots return to.
   *
   * @returns `false` when no clip is registered under `name`.
   */
  function setIdleMotion(name: string, crossfade = DEFAULT_CROSSFADE): boolean {
    const clip = registry.get(name)
    if (!clip) {
      console.warn(`[mmd] setIdleMotion skipped: "${name}" is not registered`)
      return false
    }

    pipeline.enqueue(() => {
      const action = mixer.clipAction(clip)
      action.reset()
      action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY)
      action.clampWhenFinished = false
      action.setEffectiveWeight(1)
      action.fadeIn(crossfade).play()

      const previousIdle = idleAction
      idleAction = action
      if (currentAction && currentAction !== action) {
        removeFinishListener(currentAction)
        currentAction.fadeOut(crossfade)
      }
      else if (previousIdle && previousIdle !== action) {
        previousIdle.fadeOut(crossfade)
      }
      currentAction = action
    })
    return true
  }

  function ease(action: AnimationAction, to: number, duration: number): void {
    baseFades.set(action, { from: action.weight, to, elapsed: 0, duration })
  }

  function advanceBaseFades(delta: number): void {
    for (const [action, fade] of baseFades) {
      fade.elapsed += delta
      const progress = fade.duration > 0 ? Math.min(1, fade.elapsed / fade.duration) : 1
      const eased = progress * progress * (3 - 2 * progress)
      action.weight = fade.from + (fade.to - fade.from) * eased
      if (progress < 1)
        continue
      baseFades.delete(action)
      if (fade.to === 0 && action !== idleAction && action !== currentAction)
        action.stop()
    }
  }

  /**
   * Replaces the looping base clip, or fades it out to the rest pose when
   * `name` is `null`. A running one-shot keeps playing and returns to the new
   * base when it finishes.
   *
   * The weights follow a smoothstep instead of three's linear fade: a nearly
   * straight IK leg turns with the square root of the hip drop, so a linear
   * fade into a crouching clip snaps the thighs on its first frame.
   *
   * @returns `false` when no clip is registered under `name`.
   */
  function setBaseMotion(name: string | null, crossfade = BASE_CROSSFADE): boolean {
    const clip = name === null ? undefined : registry.get(name)
    if (name !== null && !clip) {
      console.warn(`[mmd] setBaseMotion skipped: "${name}" is not registered`)
      return false
    }

    pipeline.enqueue(() => {
      const next = clip ? mixer.clipAction(clip) : undefined
      const previous = idleAction
      if (next === previous)
        return
      if (previous)
        ease(previous, 0, crossfade)
      if (next) {
        if (!next.isRunning()) {
          next.reset()
          next.weight = 0
        }
        next.setLoop(LoopRepeat, Number.POSITIVE_INFINITY)
        next.clampWhenFinished = false
        next.play()
        ease(next, 1, crossfade)
      }
      idleAction = next
      if (!currentAction || currentAction === previous)
        currentAction = next
    })
    return true
  }

  function setPhysicsEnabled(enabled: boolean): void {
    pipeline.options.physics = enabled
  }

  /** Sets physics gravity to `(0, -magnitude, 0)`, including during init. */
  function setGravity(magnitude: number): void {
    gravity = magnitude
    mmd.physics?.setGravity?.(new Vector3(0, -magnitude, 0))
  }

  function setIKEnabled(enabled: boolean): void {
    pipeline.options.ik = enabled
  }

  function setGrantEnabled(enabled: boolean): void {
    pipeline.options.grant = enabled
  }

  function update(delta: number): void {
    if (!initialized || disposed)
      return
    // Match the pipeline's own dt clamp so fades and clips advance together.
    advanceBaseFades(Math.min(delta, 1 / 20))
    pipeline.step(delta)
  }

  function dispose(): void {
    if (disposed)
      return
    disposed = true

    for (const listener of finishListeners.values())
      mixer.removeEventListener('finished', listener)
    finishListeners.clear()
    baseFades.clear()
    pipeline.dispose()
    mixer.stopAllAction()
    mixer.uncacheRoot(mmd.mesh)
    mmd.dispose()
    registry.clear()
    idleAction = undefined
    currentAction = undefined
    initialized = false
  }

  return {
    pipeline,
    snapshot: () => ({
      idle: idleAction ? [...registry].find(([, clip]) => clip === idleAction?.getClip())?.[0] ?? null : null,
      currentAction: currentAction ? [...registry].find(([, clip]) => clip === currentAction?.getClip())?.[0] ?? null : null,
      actionsStarted,
    }),
    init,
    registerClip,
    availableClips,
    playIdle,
    playAction,
    setIdleMotion,
    setBaseMotion,
    setPhysicsEnabled,
    setGravity,
    setIKEnabled,
    setGrantEnabled,
    update,
    dispose,
  }
}

export type MMDAnimationManager = ReturnType<typeof createMMDAnimationManager>
