import type { FrameMeasurement, StageTiming } from '../composables/mmd/frame-metrics'
import type { MMDRigProfile } from '../composables/mmd/rig'

import { defineStore } from 'pinia'
import { onScopeDispose, ref, shallowRef } from 'vue'

import { MMDFrameMetrics } from '../composables/mmd/frame-metrics'

export interface MMDMotionSnapshot {
  loadedModelKey: string | null
  driver: 'natural' | 'classic'
  fps: { last: number, mean60s: number }
  timings: Record<string, StageTiming>
  rig: MMDRigProfile | null
  natural: { events: number, energy: number, headYaw: number } | null
  feet: { maxError: number, errorL: number, errorR: number, contact: number } | null
  lookAt: { target: { x: number, y: number, z: number } | null, yaw: number, pitch: number, turning: boolean, turns: number } | null
  director: { stance: string, sinceMs: number, reason: string, clockOffsetMs: number } | null
  touch: { lastRegion: string | null, hitBody: boolean, petActive: boolean, headScreenPoint: { x: number, y: number } | null, events: number } | null
  animation: { idle: string | null, currentAction: string | null, actionsStarted: number }
  measurement: FrameMeasurement | null
}

export type MMDMotionCommand
  = | { type: 'command', name: 'startMeasurement' | 'stopMeasurement', value?: undefined }
    | { type: 'command', name: 'setDebugFlag', value: { flag: 'disableFootContact' | 'disableLookAt', on: boolean } }
    | { type: 'command', name: 'advanceDirectorClock', value: number }
    | { type: 'command', name: 'setOverlay', value: unknown }

export const useMMDMotionDiagnostics = defineStore('mmd-motion-diagnostics', () => {
  const channel = typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('airi-stores-stage-ui-mmd-motion-diagnostics')
  let metrics = new MMDFrameMetrics()
  let warned = false
  const debugFlags = ref({ disableFootContact: false, disableLookAt: false })
  const directorClockOffsetMs = ref(0)
  const overlay = shallowRef<unknown>(null)
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
    measurement: null,
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
        overlay.value = value
        break
      default:
        warn()
    }
  }

  function onMessage(event: MessageEvent<unknown>) {
    receive(event.data)
  }
  channel?.addEventListener('message', onMessage)
  onScopeDispose(() => {
    channel?.removeEventListener('message', onMessage)
    channel?.close()
  })

  function publish(state: Partial<MMDMotionSnapshot> = {}): void {
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
    overlay,
    publish,
    command,
    setMetrics: (next: MMDFrameMetrics) => { metrics = next },
    recordFrame: (delta: number) => metrics.recordFrame(delta),
    measure: (id: string, run: () => void) => metrics.measure(id, run),
  }
})
