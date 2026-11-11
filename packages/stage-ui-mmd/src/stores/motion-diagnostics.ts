import type { BroadcastChannelEmitOptions } from '@moeru/eventa/adapters/broadcast-channel'
import type { ClipMaskGroup } from '@proj-airi/motion-driver-humanoid/clip-mask'
import type { ClipKind, ClipLayer, ClipMetaNote } from '@proj-airi/motion-driver-humanoid/clip-meta'
import type { LocomotionFrame } from '@proj-airi/motion-driver-humanoid/locomotion'
import type { BodyCapabilities } from '@proj-airi/motion-driver-humanoid/performance'
import type { BodyLocomotionReason, LocomotionPace } from '@proj-airi/motion-driver-humanoid/types'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'

import type { FrameMeasurement, StageTiming } from '../composables/mmd/frame-metrics'
import type { MMDOverlayFlags } from '../composables/mmd/overlay-flags'
import type { MMDRigProfile } from '../composables/mmd/rig'
import type { MMDStanceDiagnostics } from '../composables/mmd/stance'
import type { MMDRoamMode } from './mmd'
import type { MMDMotionTraceCommand, MMDMotionTraceSnapshot, MMDMotionTraceSource } from './motion-trace'

import { createContext, defineEventa } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'
import { defineStore } from 'pinia'
import { onScopeDispose, ref, shallowRef } from 'vue'

import { MMDFrameMetrics } from '../composables/mmd/frame-metrics'
import { isMMDOverlayFlags, mmdOverlayFlagNames, mmdOverlaysOff } from '../composables/mmd/overlay-flags'
import { MMDMotionTrace } from './motion-trace'

/** The lab turns stage overlays on or off in every window. Not persisted: a reloaded stage starts with them off. */
export const mmdOverlaySetEvent = defineEventa<Partial<MMDOverlayFlags>>('eventa:event:mmd:motion-diagnostics:overlay:set')

export interface MMDMotionSnapshot {
  loadedModelKey: string | null
  driver: 'natural' | 'classic'
  fps: { last: number, mean60s: number }
  timings: Record<string, StageTiming>
  /** The rig profile; `capabilities` is the body performer's load-time gesture and head-clearance result, null without a performer. */
  rig: (MMDRigProfile & { capabilities: BodyCapabilities | null }) | null
  natural: { events: number, energy: number, headYaw: number } | null
  feet: { maxError: number, errorL: number, errorR: number, contact: number } | null
  lookAt: { target: { x: number, y: number, z: number } | null, yaw: number, pitch: number, turning: boolean, turns: number } | null
  /**
   * The body director. `stanceReason` explains the stance; `reason` is the locomotion reason of the goal in progress
   * (`approach-chat`, `approach-cursor`, `return-home`, `wander`, `tool`, `debug`, `enter-stage`, or `stay`).
   */
  /** `centerY` is the センター bone's Y in model units (mesh space), independent of the view scale. */
  director: (MMDStanceDiagnostics & { clockOffsetMs: number, centerY: number | null }) | null
  touch: { lastRegion: string | null, hitBody: boolean, petActive: boolean, headScreenPoint: { x: number, y: number } | null, events: number } | null
  animation: { idle: string | null, currentAction: string | null, actionsStarted: number, layer: { seq: number, name: string, state: 'playing' | 'finished' } | null }
  /**
   * The action layer. `performing` is the clip the director accepted (`name` is its clip name), `refusal` and
   * `retryAfterMs` the last refused request, and `drops` count ACT action labels the scene did not play.
   */
  action: {
    performing: { name: string, layer: 'full' | 'upper', phase: 'settling' | 'playing', seq: number } | null
    lastActionSeq: number
    refusal: MMDStanceDiagnostics['actionRefusal']
    retryAfterMs: number | null
    drops: { unknown: number, notExposed: number, notGesture: number, superseded: number }
  }
  /**
   * The imported clips of the loaded model with their effective kind and layer; `downgraded` marks a gesture override
   * that forced a full clip onto the upper layer, and `notes` are the derivation notes (why a clip is `unusable`).
   */
  clips: Array<{ name: string, kind: ClipKind, layer: ClipLayer, loop: boolean, label: string | null, exposed: boolean, downgraded: boolean, notes: ClipMetaNote[] }>
  /** Stage mode only: the character's projected rect in work-area DIP, with the root at its current x. */
  characterPlacement: PlacementRect | null
  /** Stage mode only: the measured model height and foot baseline in model units, which the host calibrates the camera from. */
  stageModel: { height: number, footBaselineY: number } | null
  measurement: FrameMeasurement | null
  /**
   * The gait, in world units on the ground line. `skate` is the largest per-frame horizontal world movement of a planted
   * ankle (0 when feet stay planted), `leashClamps` counts ticks on which the reach leash shortened root travel, and
   * `enabled` is false while a clip owns the body.
   */
  locomotion: {
    mode: LocomotionFrame['mode']
    position: { x: number, z: number }
    yaw: number
    goalX: number | null
    reason: BodyLocomotionReason | null
    pace: LocomotionPace | null
    speed: number
    phase: number
    weight: number
    skate: number
    leashClamps: number
    enabled: boolean
  } | null
  /**
   * The arm rest layer. `weight` is one minus the larger arm ownership, `owned` the clip ownership per group (0-1),
   * `penetration` the deepest arm capsule-radius overlap of a kinematic torso, hip, leg or skirt-root body in model units
   * (the gate: 0), `clothContact` the deepest centerline overlap of a dynamic cloth body (information only), `hangDeg`
   * the rest upper-arm hang in effect (default, solved per rig, or the debug override), and `handBelowHip`
   * whether both hand bones sit below the hips bone.
   */
  arms: {
    weight: number
    owned: { leftArm: number, rightArm: number, leftFingers: number, rightFingers: number }
    penetration: { left: number, right: number }
    clothContact: { left: number, right: number }
    hangDeg: number
    handBelowHip: boolean
    /** Deepest arm overlap of a kinematic head or neck body per side, in model units, after physics. */
    headPenetration: { left: number, right: number }
    /** The performer's arm collision correction in effect per side, in degrees. */
    correctionDeg: { left: number, right: number }
  } | null
  /** The overlay flags the stage draws, so a lab opened after a toggle shows the stage's state. */
  overlays: MMDOverlayFlags
  /**
   * Stage mode only: the calibration the stage world was built from. `unitsPerDip` converts work-area DIP to model
   * units on the floor line, `floorRowDip` is the floor line's work-area row, `ground` the reachable x range in model
   * units, `homeX` the resting root x and `characterHeightDip` the configured character height.
   */
  world: { unitsPerDip: number, floorRowDip: number, ground: { minX: number, maxX: number }, homeX: number, characterHeightDip: number, originX: number, reach: { minX: number, maxX: number }[] | null } | null
  /** The body's clip ownership per mask group (0-1) while the Natural driver runs; `arms.owned` repeats the arm groups. */
  ownership: Record<ClipMaskGroup, number> | null
  trace: MMDMotionTraceSnapshot | null
  /**
   * The body performer while the Natural driver runs. `tick` counts 120 Hz ticks since its reset; `layers` maps each
   * performance layer to 1 on or 0 off; `support` is the weight support, +1 on the right foot; `shift` the scheduled
   * support target and remaining dwell; `breath` the speech chest lift and phrase inhale count; `gaze` the goal kind,
   * the last planned shift and the eye, head and trunk angles in degrees with the shift and body blink counts;
   * `correctionDeg` the arm collision correction; `collision` the count of ticks on which an arm had no clear pose and
   * kept its previous one, with the latest side, depth and tick. Appended: `corrector` counts the arm ticks on which the
   * 6 degree cap bounded a projection and on which the guard scan began; `writeDeviationRad` the largest angle this
   * frame between a written local rotation and the clean pose per written group; `gestureActivation` the weight gesture
   * layers applied to each arm; `arms` the nine displayed arm angles per side and their rest values, in degrees.
   */
  performance: {
    tick: number
    layers: Record<string, number>
    support: number
    shift: { target: number, dwellS: number }
    breath: { speechLift: number, inhales: number }
    gaze: { kind: 'sustained' | 'free' | 'travel', shiftDeg: number, eyeDeg: number, headDeg: number, trunkDeg: number, shifts: number, blinks: number }
    correctionDeg: { left: number, right: number }
    collision: { count: number, last: { side: 'left' | 'right', depth: number, tick: number } | null }
    corrector: { capHits: number, guardScans: number }
    writeDeviationRad: { hips: number, torso: number, head: number, leftArm: number, rightArm: number, leftFingers: number, rightFingers: number }
    gestureActivation: { left: number, right: number }
    arms: { deg: { left: number[], right: number[] }, restDeg: { left: number[], right: number[] } }
  } | null
}

export type MMDMotionCommand
  = | { type: 'command', name: 'startMeasurement' | 'stopMeasurement', value?: undefined }
    | { type: 'command', name: 'setDebugFlag', value: { flag: 'disableFootContact' | 'disableLookAt', on: boolean } | { flag: 'armRestHangDeg', value: number | null } }
    | { type: 'command', name: 'advanceDirectorClock', value: number }
    | { type: 'command', name: 'setOverlay', value: Partial<MMDOverlayFlags> }
    | { type: 'command', name: 'requestGoal', value: { x: number, pace: LocomotionPace } }
    | { type: 'command', name: 'setHome', value: { x: number } }
    | { type: 'command', name: 'setRoamMode', value: { mode: MMDRoamMode } }
    | { type: 'command', name: 'playClip', value: { name: string, loop?: boolean } }
    | { type: 'command', name: 'stopClip', value?: undefined }
    | { type: 'command', name: 'setPerformanceLayer', value: { layer: string, enabled: boolean } }
    | MMDMotionTraceCommand

function isRoamMode(value: unknown): value is MMDRoamMode {
  return value === 'stay' || value === 'roam'
}

function isLocomotionPace(value: unknown): value is LocomotionPace {
  return value === 'stroll' || value === 'walk'
}

function finiteX(value: unknown): number | null {
  return typeof value === 'object' && value !== null && 'x' in value && typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : null
}

function isSnapshotMessage(data: unknown): data is { type: 'snapshot', snapshot: MMDMotionSnapshot } {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === 'snapshot'
    && 'snapshot' in data && typeof data.snapshot === 'object' && data.snapshot !== null && 'loadedModelKey' in data.snapshot
}

function isRawMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && 'type' in data && (data.type === 'command' || data.type === 'snapshot' || data.type === 'trace')
}

export const useMMDMotionDiagnostics = defineStore('mmd-motion-diagnostics', () => {
  const channel = typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('airi-stores-stage-ui-mmd-motion-diagnostics')
  let metrics = new MMDFrameMetrics()
  const trace = new MMDMotionTrace(message => channel?.postMessage(message))
  let warned = false
  /** `armRestHangDeg` is the rest upper-arm angle below horizontal for QA, 0-90; null keeps the default. */
  const debugFlags = ref<{ disableFootContact: boolean, disableLookAt: boolean, armRestHangDeg: number | null }>({ disableFootContact: false, disableLookAt: false, armRestHangDeg: null })
  const directorClockOffsetMs = ref(0)
  const overlays = shallowRef<MMDOverlayFlags>({ ...mmdOverlaysOff })
  /** The latest walk goal from the lab; a new `seq` marks a new request, even to the same x. */
  const goalRequest = shallowRef<{ seq: number, x: number, pace: LocomotionPace } | null>(null)
  /** Home x set from the lab; todo 12's director reads it as its home spot. */
  const homeX = ref<number | null>(null)
  /** The roam mode the lab asked for; the stage writes it to the `mmd` store's `roamMode` setting. */
  const roamModeRequest = shallowRef<{ seq: number, mode: MMDRoamMode } | null>(null)
  /**
   * The latest lab clip request; a new `seq` marks a new request, and `name: null` is a stop. The stage queues it on the
   * director as a `debug` request; `loop` unset keeps the clip's own loop setting.
   */
  const clipRequest = shallowRef<{ seq: number, name: string | null, loop: boolean | undefined } | null>(null)
  /** The latest lab request to turn one performance layer on or off; a new `seq` marks a new request. */
  const performanceLayerRequest = shallowRef<{ seq: number, layer: string, enabled: boolean } | null>(null)
  /** Set once this window's stage publishes; a stage window never mirrors another window's snapshots. */
  let publisher = false
  const snapshot = shallowRef<MMDMotionSnapshot>({
    loadedModelKey: null,
    driver: 'classic',
    fps: { last: 0, mean60s: 0 },
    timings: {},
    rig: null,
    natural: null,
    feet: null,
    lookAt: null,
    director: null,
    touch: null,
    animation: { idle: null, currentAction: null, actionsStarted: 0, layer: null },
    action: { performing: null, lastActionSeq: 0, refusal: null, retryAfterMs: null, drops: { unknown: 0, notExposed: 0, notGesture: 0, superseded: 0 } },
    clips: [],
    characterPlacement: null,
    stageModel: null,
    measurement: null,
    locomotion: null,
    arms: null,
    overlays: { ...mmdOverlaysOff },
    world: null,
    ownership: null,
    trace: null,
    performance: null,
  })

  function warn() {
    if (warned)
      return
    warned = true
    console.warn('[mmd] ignored unknown or malformed diagnostics command')
  }

  /** Boundary parser for the plan's raw BroadcastChannel command protocol. */
  function receive(data: unknown, remote = false): void {
    if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== 'command')
      return
    if (!('name' in data)) {
      warn()
      return
    }
    const value = 'value' in data ? data.value : undefined
    switch (data.name) {
      case 'startMeasurement':
        if (trace.snapshot()?.state === 'recording')
          break
        metrics.startMeasurement()
        break
      case 'stopMeasurement':
        metrics.stopMeasurement()
        break
      case 'setDebugFlag':
        if (typeof value === 'object' && value !== null && 'flag' in value && value.flag === 'armRestHangDeg' && 'value' in value) {
          const degrees = value.value
          if (degrees !== null && (typeof degrees !== 'number' || !(degrees >= 0) || !(degrees <= 90))) {
            warn()
            return
          }
          debugFlags.value.armRestHangDeg = degrees
          break
        }
        if (typeof value !== 'object' || value === null || !('flag' in value) || !('on' in value)
          || (value.flag !== 'disableFootContact' && value.flag !== 'disableLookAt') || typeof value.on !== 'boolean') {
          warn()
          return
        }
        debugFlags.value[value.flag] = value.on
        break
      case 'advanceDirectorClock':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          warn()
          return
        }
        directorClockOffsetMs.value += value
        break
      case 'setOverlay':
        if (!isMMDOverlayFlags(value)) {
          warn()
          return
        }
        overlays.value = { ...overlays.value, ...value }
        break
      case 'requestGoal': {
        const x = finiteX(value)
        if (x === null || typeof value !== 'object' || value === null || !('pace' in value) || !isLocomotionPace(value.pace)) {
          warn()
          return
        }
        goalRequest.value = { seq: (goalRequest.value?.seq ?? 0) + 1, x, pace: value.pace }
        break
      }
      case 'setHome': {
        const x = finiteX(value)
        if (x === null) {
          warn()
          return
        }
        homeX.value = x
        break
      }
      case 'setRoamMode': {
        if (typeof value !== 'object' || value === null || !('mode' in value) || !isRoamMode(value.mode)) {
          warn()
          return
        }
        roamModeRequest.value = { seq: (roamModeRequest.value?.seq ?? 0) + 1, mode: value.mode }
        break
      }
      case 'playClip': {
        if (typeof value !== 'object' || value === null || !('name' in value) || typeof value.name !== 'string' || value.name === '') {
          warn()
          return
        }
        const loop = 'loop' in value ? value.loop : undefined
        if (loop !== undefined && typeof loop !== 'boolean') {
          warn()
          return
        }
        clipRequest.value = { seq: (clipRequest.value?.seq ?? 0) + 1, name: value.name, loop }
        break
      }
      case 'stopClip':
        clipRequest.value = { seq: (clipRequest.value?.seq ?? 0) + 1, name: null, loop: undefined }
        break
      case 'setPerformanceLayer':
        if (typeof value !== 'object' || value === null || !('layer' in value) || typeof value.layer !== 'string' || value.layer === ''
          || !('enabled' in value) || typeof value.enabled !== 'boolean') {
          warn()
          return
        }
        performanceLayerRequest.value = { seq: (performanceLayerRequest.value?.seq ?? 0) + 1, layer: value.layer, enabled: value.enabled }
        break
      case 'startTrace':
      case 'markTrace':
      case 'stopTrace':
      case 'drainTrace':
        if (remote && !publisher)
          return
        trace.receive(data.name, value, metrics.measurement()?.state === 'running')
        break
      default:
        warn()
    }
  }

  // NOTICE:
  // Raw command and snapshot messages share this channel, so this earlier listener stops them before Eventa.
  // The Eventa adapter logs a parse error for every non-Eventa message.
  // Source: `restoreInner` in node_modules/@moeru/eventa/dist/internal-*.mjs; the Live2D store does the same.
  // Remove when the raw BroadcastChannel command protocol moves to Eventa contracts.
  function onMessage(event: MessageEvent<unknown>) {
    if (!isRawMessage(event.data))
      return
    event.stopImmediatePropagation()
    if (isSnapshotMessage(event.data)) {
      if (!publisher) {
        snapshot.value = event.data.snapshot
        mirrorOverlays(event.data.snapshot.overlays)
      }
      return
    }
    receive(event.data, true)
  }
  channel?.addEventListener('message', onMessage)
  const { context, dispose } = channel
    ? createBroadcastChannelContext(channel)
    : { context: createContext<undefined, BroadcastChannelEmitOptions>(), dispose: () => {} }
  context.on(mmdOverlaySetEvent, ({ body }) => {
    if (body)
      overlays.value = { ...overlays.value, ...body }
  })
  onScopeDispose(() => {
    trace.setSource(null)
    dispose()
    channel?.removeEventListener('message', onMessage)
    channel?.close()
  })

  /** A mirroring window adopts the stage's flags; an equal set is left alone so the toggles do not re-render at 10 Hz. */
  function mirrorOverlays(flags: MMDOverlayFlags): void {
    if (mmdOverlayFlagNames.some(flag => overlays.value[flag] !== flags[flag]))
      overlays.value = { ...flags }
  }

  /** Turns stage overlays on or off in every window over the Eventa contract. */
  function setOverlays(patch: Partial<MMDOverlayFlags>): void {
    void context.emit(mmdOverlaySetEvent, patch)
  }

  function publish(state: Partial<MMDMotionSnapshot> = {}): void {
    publisher = true
    snapshot.value = {
      ...snapshot.value,
      ...state,
      fps: metrics.fps(),
      timings: metrics.timings(),
      measurement: metrics.measurement(),
      trace: trace.snapshot(),
      overlays: overlays.value,
    }
    channel?.postMessage({ type: 'snapshot', snapshot: snapshot.value })
  }

  /** Local callers and remote windows use the same command parser. */
  function command(message: MMDMotionCommand): void {
    receive(message)
    channel?.postMessage(message)
  }

  return {
    snapshot,
    debugFlags,
    directorClockOffsetMs,
    overlays,
    goalRequest,
    homeX,
    roamModeRequest,
    clipRequest,
    performanceLayerRequest,
    publish,
    command,
    setOverlays,
    setMetrics: (next: MMDFrameMetrics) => { metrics = next },
    setTraceSource: (source: MMDMotionTraceSource | null) => trace.setSource(source),
    recordFrame: (delta: number) => metrics.recordFrame(delta),
    measure: (id: string, run: () => void) => metrics.measure(id, run),
    /** The host page times its alpha readback; the next published `measurement` carries the last second of samples. */
    reportReadback: (ms: number) => metrics.recordReadback(ms, performance.now()),
  }
})
