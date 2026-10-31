import type { BroadcastChannelEmitOptions } from '@moeru/eventa/adapters/broadcast-channel'
import type { LocomotionFrame } from '@proj-airi/motion-driver-humanoid/locomotion'
import type { BodyLocomotionReason, LocomotionPace } from '@proj-airi/motion-driver-humanoid/types'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'

import type { FrameMeasurement, StageTiming } from '../composables/mmd/frame-metrics'
import type { MMDOverlayFlags } from '../composables/mmd/overlay-flags'
import type { MMDRigProfile } from '../composables/mmd/rig'

import { createContext, defineEventa } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'
import { defineStore } from 'pinia'
import { onScopeDispose, ref, shallowRef } from 'vue'

import { MMDFrameMetrics } from '../composables/mmd/frame-metrics'
import { isMMDOverlayFlags, mmdOverlaysOff } from '../composables/mmd/overlay-flags'

/** The lab turns stage overlays on or off in every window. Not persisted: a reloaded stage starts with them off. */
export const mmdOverlaySetEvent = defineEventa<Partial<MMDOverlayFlags>>('eventa:event:mmd:motion-diagnostics:overlay:set')

export interface MMDMotionSnapshot {
  loadedModelKey: string | null
  driver: 'natural' | 'classic'
  fps: { last: number, mean60s: number }
  timings: Record<string, StageTiming>
  rig: MMDRigProfile | null
  natural: { events: number, energy: number, headYaw: number } | null
  feet: { maxError: number, errorL: number, errorR: number, contact: number } | null
  lookAt: { target: { x: number, y: number, z: number } | null, yaw: number, pitch: number, turning: boolean, turns: number } | null
  /** `centerY` is the センター bone's Y in model units (mesh space), independent of the view scale. */
  director: { stance: string, sinceMs: number, reason: string, clockOffsetMs: number, centerY: number | null } | null
  touch: { lastRegion: string | null, hitBody: boolean, petActive: boolean, headScreenPoint: { x: number, y: number } | null, events: number } | null
  animation: { idle: string | null, currentAction: string | null, actionsStarted: number }
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
   * `penetration` the deepest arm capsule entry into a torso, hip or skirt body in model units, and `handBelowHip`
   * whether both hand bones sit below the hips bone.
   */
  arms: {
    weight: number
    owned: { leftArm: number, rightArm: number, leftFingers: number, rightFingers: number }
    penetration: { left: number, right: number }
    handBelowHip: boolean
  } | null
}

export type MMDMotionCommand
  = | { type: 'command', name: 'startMeasurement' | 'stopMeasurement', value?: undefined }
    | { type: 'command', name: 'setDebugFlag', value: { flag: 'disableFootContact' | 'disableLookAt', on: boolean } | { flag: 'armRestHangDeg', value: number | null } }
    | { type: 'command', name: 'advanceDirectorClock', value: number }
    | { type: 'command', name: 'setOverlay', value: Partial<MMDOverlayFlags> }
    | { type: 'command', name: 'requestGoal', value: { x: number, pace: LocomotionPace } }
    | { type: 'command', name: 'setHome', value: { x: number } }

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
  return typeof data === 'object' && data !== null && 'type' in data && (data.type === 'command' || data.type === 'snapshot')
}

export const useMMDMotionDiagnostics = defineStore('mmd-motion-diagnostics', () => {
  const channel = typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('airi-stores-stage-ui-mmd-motion-diagnostics')
  let metrics = new MMDFrameMetrics()
  let warned = false
  /** `armRestHangDeg` is the rest upper-arm angle below horizontal for QA, 0-90; null keeps the default. */
  const debugFlags = ref<{ disableFootContact: boolean, disableLookAt: boolean, armRestHangDeg: number | null }>({ disableFootContact: false, disableLookAt: false, armRestHangDeg: null })
  const directorClockOffsetMs = ref(0)
  const overlays = shallowRef<MMDOverlayFlags>({ ...mmdOverlaysOff })
  /** The latest walk goal from the lab; a new `seq` marks a new request, even to the same x. */
  const goalRequest = shallowRef<{ seq: number, x: number, pace: LocomotionPace } | null>(null)
  /** Home x set from the lab; todo 12's director reads it as its home spot. */
  const homeX = ref<number | null>(null)
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
    animation: { idle: null, currentAction: null, actionsStarted: 0 },
    characterPlacement: null,
    stageModel: null,
    measurement: null,
    locomotion: null,
    arms: null,
  })

  function warn() {
    if (warned)
      return
    warned = true
    console.warn('[mmd] ignored unknown or malformed diagnostics command')
  }

  /** Boundary parser for the plan's raw BroadcastChannel command protocol. */
  function receive(data: unknown): void {
    if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== 'command')
      return
    if (!('name' in data)) {
      warn()
      return
    }
    const value = 'value' in data ? data.value : undefined
    switch (data.name) {
      case 'startMeasurement':
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
      if (!publisher)
        snapshot.value = event.data.snapshot
      return
    }
    receive(event.data)
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
    dispose()
    channel?.removeEventListener('message', onMessage)
    channel?.close()
  })

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
    publish,
    command,
    setOverlays,
    setMetrics: (next: MMDFrameMetrics) => { metrics = next },
    recordFrame: (delta: number) => metrics.recordFrame(delta),
    measure: (id: string, run: () => void) => metrics.measure(id, run),
    /** The host page times its alpha readback; the next published `measurement` carries the last second of samples. */
    reportReadback: (ms: number) => metrics.recordReadback(ms, performance.now()),
  }
})
