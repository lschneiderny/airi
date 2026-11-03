import type { MMD } from '@moeru/three-mmd'
import type { ClipMaskBones } from '@proj-airi/motion-driver-humanoid/clip-mask'
import type { AnimationAction, AnimationClip } from 'three'

import { AnimationMixer, LoopOnce, LoopRepeat, Vector3 } from 'three'

import { ensureAmmo } from '../../utils/ammo'
import { MMDFramePipeline } from './frame-pipeline'
import { partitionClipByBones, splitClipByLayer, trackBoneName } from './rig/clip-split'

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
  /**
   * The rig's bone names, used to split clips per bone group. Without them `registerClip`
   * ignores `split` and an upper layer plays the whole clip.
   */
  maskBones?: ClipMaskBones
}

export interface RegisterClipOptions {
  /** The layer `playLayer` uses when it is not given one. @default 'full' */
  layer?: 'upper' | 'full'
  /** Also register the clip's own `#upper` and `#lower` partitions. */
  split?: boolean
  /** Rig bones with a non-rest key (`ClipBoneMask.animatedBones`); the upper partition keeps only these. */
  animatedBones?: readonly string[]
}

export interface PlayLayerOptions {
  /** Caller-chosen id echoed by layer events and `snapshot().layer`. */
  seq: number
  /** `upper` takes over the gesture's animated bones only; `full` takes over every bone the clip keys. */
  layer?: 'upper' | 'full'
  /** Repeat the clip. Ignored for dances. @default false */
  loop?: boolean
  /** Ease-in duration in seconds. @default 0.25 upper, 0.4 full, 0.6 dance */
  crossfade?: number
  /** Dances never loop. @default 'action' */
  kind?: 'action' | 'dance'
}

export interface LayerEvent {
  seq: number
  state: 'playing' | 'finished' | 'failed'
  notes?: string[]
}

/** Base tracks cut by which live layers take their bones over; `members` indexes the layers at cut time. */
interface BasePartition {
  base: string
  gestures: string[]
  baseClip: AnimationClip
  gestureClips: AnimationClip[]
  cells: Array<{ members: number[], clip: AnimationClip }>
}

interface BaseSplit {
  /** The ids of the live layers the cells were cut for. */
  signature: string
  /** The carrier's partitions; the cell no layer takes over has no members and keeps the carrier's full weight. */
  cells: Array<{ members: Layer[], action: AnimationAction }>
}

interface Layer {
  id: number
  seq: number
  name: string
  mode: 'upper' | 'full'
  state: 'playing' | 'finished'
  action: AnimationAction
  /** The action plays a private clone of the clip because an older layer still plays the original. */
  cloned: boolean
  partKey: string
  yieldBones: ReadonlySet<string>
  amount: number
  fade: { from: number, to: number, elapsed: number, duration: number } | null
  outDuration: number
  announced: boolean
  ending: boolean
  tearing: boolean
  notes?: string[]
}

const UPPER_FADE_IN = 0.25
const UPPER_FADE_OUT = 0.3
const FULL_FADE_IN = 0.4
const DANCE_FADE_IN = 0.6

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
  const maskBones = options.maskBones
  const registered = new Map<string, RegisterClipOptions>()
  /** Own `#upper` and `#lower` partitions, kept out of `registry` so they never show as motions. */
  const partitions = new Map<string, AnimationClip>()
  /** Base clip partitions per base/gesture pair; entries remember their source clips to detect staleness. */
  const basePartitions = new Map<string, BasePartition>()
  /** While an upper or full layer plays, each running base action (the carrier) is disabled and drives its partitions' weights. */
  const splits = new Map<AnimationAction, BaseSplit>()
  const layerListeners = new Set<(event: LayerEvent) => void>()
  /** Live layers, oldest first. More than one only while a replaced layer eases out. */
  const layers: Layer[] = []
  let nextLayerId = 0

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
  function registerClip(name: string, clip: AnimationClip, clipOptions: RegisterClipOptions = {}): void {
    registry.set(name, clip)
    registered.set(name, clipOptions)
    pipeline.registerClip(name, clip)
    // A re-registered clip must never play from partitions cut from its predecessor.
    for (const [key, entry] of basePartitions) {
      if (entry.base === name || entry.gestures.includes(name))
        basePartitions.delete(key)
    }
    for (const suffix of ['upper', 'lower'])
      partitions.delete(`${name}#${suffix}`)
    if (clipOptions.split)
      splitRegistered(name, clip, clipOptions)
  }

  function splitRegistered(name: string, clip: AnimationClip, clipOptions: RegisterClipOptions): AnimationClip | undefined {
    if (!maskBones) {
      console.warn(`[mmd] registerClip split skipped for "${name}": the manager has no maskBones`)
      return undefined
    }
    const { upper, lower } = splitClipByLayer(clip, maskBones, clipOptions.animatedBones ? new Set(clipOptions.animatedBones) : undefined)
    partitions.set(upper.name, upper)
    partitions.set(lower.name, lower)
    return upper
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
      if (fade.to === 0 && action !== idleAction && action !== currentAction) {
        dropSplit(action)
        action.stop()
      }
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
      // A new base must not play over a layer that has taken over its bones.
      if (layers.length > 0 && next)
        applySplit(next)
    })
    return true
  }

  function clipName(clip: AnimationClip): string {
    return [...registry].find(([, candidate]) => candidate === clip)?.[0] ?? clip.name
  }

  function basePartitionFor(carrier: AnimationAction): BasePartition {
    const baseClip = carrier.getClip()
    const base = clipName(baseClip)
    const key = [base, ...layers.map(active => active.partKey)].join('\u0000')
    const gestureClips = layers.map(active => active.action.getClip())
    const cached = basePartitions.get(key)
    if (cached && cached.baseClip === baseClip && cached.gestureClips.length === gestureClips.length && cached.gestureClips.every((clip, index) => clip === gestureClips[index]))
      return cached
    // Refine the base once per live layer: every cell holds the base tracks that exactly the layers in `members` take over.
    let cells: BasePartition['cells'] = [{ members: [], clip: baseClip }]
    layers.forEach((active, index) => {
      cells = cells.flatMap((cell) => {
        const [taken, kept] = partitionClipByBones(cell.clip, active.yieldBones, '', '')
        return [{ members: [...cell.members, index], clip: taken }, { members: cell.members, clip: kept }]
      })
    })
    cells = cells.filter(cell => cell.clip.tracks.length > 0)
    for (const cell of cells) {
      cell.clip.name = cell.members.length > 0
        ? `${base}#yield(${cell.members.map(index => layers[index].name).join('+')})`
        : `${base}#keep(${layers.map(active => active.name).join('+')})`
    }
    const entry: BasePartition = { base, gestures: layers.map(active => active.name), baseClip, gestureClips, cells }
    basePartitions.set(key, entry)
    return entry
  }

  function startPartition(clip: AnimationClip, carrier: AnimationAction, time: number): AnimationAction {
    const action = mixer.clipAction(clip)
    action.reset()
    action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY)
    action.clampWhenFinished = false
    action.time = time
    action.weight = carrier.weight
    action.play()
    return action
  }

  /** A cell keeps the carrier's weight less what the layers that take over its bones cover, so every bone sums to 1. */
  function weighCells(carrier: AnimationAction, split: BaseSplit): void {
    for (const cell of split.cells) {
      const covered = cell.members.reduce((sum, member) => sum + member.amount, 0)
      cell.action.weight = carrier.weight * Math.max(0, 1 - covered)
    }
  }

  function stopCells(split: BaseSplit): void {
    for (const cell of split.cells)
      cell.action.stop()
  }

  /** Disables the carrier and plays its partitions for the live layers, re-cutting them when the layers changed. */
  function applySplit(carrier: AnimationAction): void {
    const signature = layers.map(active => active.id).join(',')
    const existing = splits.get(carrier)
    carrier.enabled = false
    if (existing?.signature === signature)
      return
    const time = existing?.cells[0]?.action.time ?? carrier.time
    if (existing)
      stopCells(existing)
    const split: BaseSplit = {
      signature,
      cells: basePartitionFor(carrier).cells.map(cell => ({
        members: cell.members.map(index => layers[index]),
        action: startPartition(cell.clip, carrier, time),
      })),
    }
    splits.set(carrier, split)
    weighCells(carrier, split)
  }

  function dropSplit(carrier: AnimationAction): void {
    const split = splits.get(carrier)
    if (!split)
      return
    stopCells(split)
    splits.delete(carrier)
    carrier.enabled = true
    pipeline.clipWeightOverrides.delete(clipName(carrier.getClip()))
  }

  function emit(seq: number, state: LayerEvent['state'], notes?: string[]): void {
    const event: LayerEvent = notes ? { seq, state, notes } : { seq, state }
    for (const listener of layerListeners)
      listener(event)
  }

  /** Removes a layer that has eased out; the base recombines into its carrier once no layer is left. Runs as a pipeline command. */
  function teardownLayer(active: Layer): void {
    const index = layers.indexOf(active)
    if (index < 0)
      return
    layers.splice(index, 1)
    active.action.stop()
    if (active.cloned)
      mixer.uncacheClip(active.action.getClip())
    if (!layers.some(other => other.name === active.name))
      pipeline.clipWeightOverrides.delete(active.name)
    for (const [carrier, split] of splits) {
      if (layers.length > 0) {
        applySplit(carrier)
        continue
      }
      const time = split.cells[0]?.action.time
      stopCells(split)
      carrier.enabled = true
      if (time !== undefined)
        carrier.time = time
      pipeline.clipWeightOverrides.delete(clipName(carrier.getClip()))
    }
    if (layers.length === 0)
      splits.clear()
  }

  function beginEnd(active: Layer): void {
    active.ending = true
    active.fade = { from: active.amount, to: 0, elapsed: 0, duration: active.outDuration }
  }

  const onLayerFinished = (event: { action: AnimationAction }) => {
    const active = layers.find(candidate => candidate.action === event.action)
    if (!active || active.state === 'finished')
      return
    active.state = 'finished'
    emit(active.seq, 'finished', active.notes)
    beginEnd(active)
  }
  mixer.addEventListener('finished', onLayerFinished)

  function syncLayers(): void {
    const nominal = new Map<string, number>()
    for (const active of layers) {
      active.action.weight = active.amount
      nominal.set(active.name, Math.max(nominal.get(active.name) ?? 0, active.amount))
    }
    for (const [carrier, split] of splits) {
      weighCells(carrier, split)
      pipeline.clipWeightOverrides.set(clipName(carrier.getClip()), carrier.weight)
    }
    // Ownership reads real clip names only: the base and the gestures, never their partitions.
    for (const [name, amount] of nominal)
      pipeline.clipWeightOverrides.set(name, amount)
  }

  function advanceLayers(delta: number): void {
    if (layers.length === 0)
      return
    for (const active of layers) {
      if (active.tearing)
        continue
      if (active.fade) {
        const fade = active.fade
        fade.elapsed += delta
        const progress = fade.duration > 0 ? Math.min(1, fade.elapsed / fade.duration) : 1
        active.amount = fade.from + (fade.to - fade.from) * progress * progress * (3 - 2 * progress)
        if (progress >= 1)
          active.fade = null
      }
      if (active.amount > 0 && !active.announced) {
        active.announced = true
        emit(active.seq, 'playing', active.notes)
      }
    }
    syncLayers()
    for (const active of layers) {
      if (active.ending && !active.fade && !active.tearing) {
        active.tearing = true
        pipeline.enqueue(() => teardownLayer(active))
      }
    }
  }

  /**
   * Plays a registered clip on a second layer over the base motion without touching the base action's
   * identity. An `upper` layer plays the clip's upper partition and splits the running base by the bones
   * that partition keys: the base's tracks for those bones ease out, every other base track keeps full
   * weight. A `full` layer takes over every bone the clip keys. The base recombines when the layer ends.
   * A layer started over a running one crossfades: the old layer eases out while the new one eases in.
   *
   * @returns `false` (after emitting `failed`) when no clip is registered under `name`.
   */
  function playLayer(name: string, layerOptions: PlayLayerOptions): boolean {
    const clip = registry.get(name)
    if (!clip) {
      console.warn(`[mmd] playLayer skipped: "${name}" is not registered`)
      emit(layerOptions.seq, 'failed')
      return false
    }

    pipeline.enqueue(() => {
      const mode = layerOptions.layer ?? registered.get(name)?.layer ?? 'full'
      const dance = layerOptions.kind === 'dance'
      const loop = !dance && (layerOptions.loop ?? false)
      const notes = dance && layerOptions.loop ? ['loop-ignored'] : undefined
      const fadeIn = layerOptions.crossfade ?? (mode === 'upper' ? UPPER_FADE_IN : dance ? DANCE_FADE_IN : FULL_FADE_IN)

      let gestureClip = clip
      if (mode === 'upper') {
        gestureClip = partitions.get(`${name}#upper`) ?? splitRegistered(name, clip, registered.get(name) ?? {}) ?? clip
      }
      const yieldBones = new Set<string>()
      for (const track of gestureClip.tracks) {
        const bone = trackBoneName(track)
        if (bone !== undefined)
          yieldBones.add(bone)
      }

      // The old layer keeps playing while it eases out, so a clip it still plays needs its own action.
      const cloned = layers.some(other => other.action.getClip() === gestureClip)
      if (cloned)
        gestureClip = gestureClip.clone()

      const previous = layers.find(other => !other.ending)
      if (previous) {
        if (previous.state === 'playing')
          emit(previous.seq, 'failed')
        beginEnd(previous)
      }

      const action = mixer.clipAction(gestureClip)
      action.reset()
      action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Number.POSITIVE_INFINITY : 1)
      action.clampWhenFinished = !loop
      action.timeScale = 1
      action.weight = 0
      action.play()

      const active: Layer = {
        id: nextLayerId++,
        seq: layerOptions.seq,
        name,
        mode,
        state: 'playing',
        action,
        cloned,
        partKey: `${mode}\u0000${name}`,
        yieldBones,
        amount: 0,
        fade: { from: 0, to: 1, elapsed: 0, duration: fadeIn },
        outDuration: mode === 'upper' ? UPPER_FADE_OUT : fadeIn,
        announced: false,
        ending: false,
        tearing: false,
        notes,
      }
      layers.push(active)

      const carriers = new Set<AnimationAction>(splits.keys())
      if (idleAction)
        carriers.add(idleAction)
      for (const [candidate, fade] of baseFades) {
        if (fade.to === 0 && candidate.weight > 0)
          carriers.add(candidate)
      }
      for (const carrier of carriers)
        applySplit(carrier)
    })
    return true
  }

  /** Eases the layer `seq` out and the base back in. Reports `failed` when it had not finished. */
  function stopLayer(seq: number): void {
    pipeline.enqueue(() => {
      const active = layers.find(other => other.seq === seq && !other.ending)
      if (!active)
        return
      if (active.state === 'playing')
        emit(active.seq, 'failed')
      beginEnd(active)
    })
  }

  /** Subscribes to layer events; returns the unsubscribe function. */
  function onLayerEvent(listener: (event: LayerEvent) => void): () => void {
    layerListeners.add(listener)
    return () => layerListeners.delete(listener)
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
    advanceLayers(Math.min(delta, 1 / 20))
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
    splits.clear()
    layers.length = 0
    layerListeners.clear()
    mixer.removeEventListener('finished', onLayerFinished)
    pipeline.dispose()
    mixer.stopAllAction()
    mixer.uncacheRoot(mmd.mesh)
    mmd.dispose()
    registry.clear()
    registered.clear()
    partitions.clear()
    basePartitions.clear()
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
      layer: layers.length > 0 ? { seq: layers.at(-1)!.seq, name: layers.at(-1)!.name, state: layers.at(-1)!.state } : null,
    }),
    init,
    registerClip,
    availableClips,
    playIdle,
    playAction,
    setIdleMotion,
    setBaseMotion,
    playLayer,
    stopLayer,
    onLayerEvent,
    setPhysicsEnabled,
    setGravity,
    setIKEnabled,
    setGrantEnabled,
    update,
    dispose,
  }
}

export type MMDAnimationManager = ReturnType<typeof createMMDAnimationManager>
