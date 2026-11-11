import type { MMDMotionCommand } from './motion-diagnostics'

import { MotionTraceRecorder } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'

import { mmdOverlaysOff } from '../composables/mmd/overlay-flags'
import { mmdOverlaySetEvent, useMMDMotionDiagnostics } from './motion-diagnostics'

describe('mmd motion diagnostics channel', () => {
  it('publishes the complete unloaded snapshot over the real channel', async () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    const peer = new BroadcastChannel('airi-stores-stage-ui-mmd-motion-diagnostics')
    try {
      const received = new Promise<unknown>((resolve, reject) => {
        const signal = AbortSignal.timeout(2000)
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        peer.addEventListener('message', event => resolve(event.data), { once: true })
      })
      store.publish()
      expect(await received).toEqual({
        type: 'snapshot',
        snapshot: {
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
          overlays: { ik: false, colliders: false, feet: false, lookAt: false, floorLine: false, groundLine: false, home: false, goal: false, armCapsules: false },
          world: null,
          ownership: null,
          trace: null,
        },
      })
    }
    finally {
      peer.close()
      disposePinia(pinia)
    }
  })

  it('starts, marks, stops and drains a scene trace through the diagnostics channel', async () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    const peer = new BroadcastChannel('airi-stores-stage-ui-mmd-motion-diagnostics')
    const recorder = new MotionTraceRecorder()
    const source = {
      recorder,
      rig: { id: 'fixture', assetSha256: null, legLength: 1, bones: ['hips'] as const, parents: [-1], restOffsets: [[0, 0, 0] as [number, number, number]], physicsOwned: [], eyeSource: 'none' as const, hasFingers: false },
      stages: { pose: ['natural'], surface: ['motion-trace'] },
      seconds: 0,
      maxSeconds: 0,
    }
    try {
      store.setTraceSource({ ...source, rig: { ...source.rig, bones: ['hips'] } })
      store.command({ type: 'command', name: 'startTrace', value: { scenario: { id: 'idle', class: 'idle', seed: 1 }, maxSeconds: 40 } })
      recorder.sample(0, 0, () => ({ x: 0, y: 0, z: 0, w: 1 }), { x: 0, y: 0, z: 0 }, {})
      store.command({ type: 'command', name: 'markTrace', value: { t: 0, kind: 'marker', label: 'ready' } })
      store.command({ type: 'command', name: 'stopTrace' })
      store.publish()
      expect(store.snapshot.trace).toMatchObject({ state: 'stopped', frames: 1, bones: 1, refused: null })
      const reply = new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('trace reply missing')), 2000)
        peer.addEventListener('message', (event) => {
          if (event.data.type === 'trace') {
            clearTimeout(timeout)
            resolve(event.data)
          }
        })
      })
      peer.postMessage({ type: 'command', name: 'drainTrace', value: { requestId: 'chunk-0', from: 0, count: 1 } })
      expect(await reply).toMatchObject({
        type: 'trace',
        requestId: 'chunk-0',
        header: { frames: 1, source: { level: 'rendered', stages: source.stages } },
        events: [{ t: 0, kind: 'marker', label: 'ready' }],
        rot: 'AAAAAAAAAAAAAAAAAACAPw==',
      })
    }
    finally {
      peer.close()
      disposePinia(pinia)
    }
  })

  it('refuses to start a trace during a frame measurement', () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    try {
      store.command({ type: 'command', name: 'startMeasurement' })
      store.command({ type: 'command', name: 'startTrace', value: { scenario: { id: 'idle', class: 'idle', seed: 1 }, maxSeconds: 40 } })
      store.publish()
      expect(store.snapshot.trace?.refused).toBe('measurement-running')
    }
    finally {
      disposePinia(pinia)
    }
  })

  it('ignores unknown commands with one warning while accepting subsequent valid commands', async () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    const peer = new BroadcastChannel('airi-stores-stage-ui-mmd-motion-diagnostics')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const applied = new Promise<void>((resolve, reject) => {
        const signal = AbortSignal.timeout(2000)
        const stop = watch(() => store.debugFlags.disableLookAt, () => resolve(), { once: true, flush: 'sync' })
        signal.addEventListener('abort', () => {
          stop()
          reject(signal.reason)
        }, { once: true })
      })
      peer.postMessage({ type: 'command', name: 'not-a-command' })
      peer.postMessage({ type: 'command', name: 'also-unknown' })
      peer.postMessage({ type: 'command', name: 'setDebugFlag', value: { flag: 'disableLookAt', on: true } })
      await applied
      expect(store.debugFlags).toEqual({ disableLookAt: true, disableFootContact: false, armRestHangDeg: null })
      expect(warning).toHaveBeenCalledTimes(1)
    }
    finally {
      warning.mockRestore()
      peer.close()
      disposePinia(pinia)
    }
  })

  it('carries overlay toggles to another window over the eventa contract and mirrors stage snapshots', async () => {
    const stagePinia = createPinia()
    const labPinia = createPinia()
    const stage = useMMDMotionDiagnostics(stagePinia)
    const lab = useMMDMotionDiagnostics(labPinia)
    try {
      const toggled = new Promise<void>((resolve, reject) => {
        const signal = AbortSignal.timeout(2000)
        const stop = watch(() => stage.overlays.colliders, () => resolve(), { once: true, flush: 'sync' })
        signal.addEventListener('abort', () => {
          stop()
          reject(signal.reason)
        }, { once: true })
      })
      lab.setOverlays({ colliders: true })
      await toggled
      expect(stage.overlays).toEqual({ ...mmdOverlaysOff, colliders: true })
      expect(lab.overlays).toEqual({ ...mmdOverlaysOff, colliders: true })

      const mirrored = new Promise<void>((resolve, reject) => {
        const signal = AbortSignal.timeout(2000)
        const stop = watch(() => lab.snapshot.loadedModelKey, () => resolve(), { once: true, flush: 'sync' })
        signal.addEventListener('abort', () => {
          stop()
          reject(signal.reason)
        }, { once: true })
      })
      stage.publish({ loadedModelKey: 'fixture', driver: 'natural' })
      await mirrored
      expect(lab.snapshot).toMatchObject({ loadedModelKey: 'fixture', driver: 'natural' })
    }
    finally {
      disposePinia(stagePinia)
      disposePinia(labPinia)
    }
  })

  it('shows a lab opened after an overlay was enabled the flags the stage publishes', async () => {
    const stagePinia = createPinia()
    const stage = useMMDMotionDiagnostics(stagePinia)
    stage.command({ type: 'command', name: 'setOverlay', value: { feet: true } })
    const labPinia = createPinia()
    const lab = useMMDMotionDiagnostics(labPinia)
    try {
      expect(lab.overlays.feet).toBe(false)
      const mirrored = new Promise<void>((resolve, reject) => {
        const signal = AbortSignal.timeout(2000)
        const stop = watch(() => lab.overlays.feet, () => resolve(), { once: true, flush: 'sync' })
        signal.addEventListener('abort', () => {
          stop()
          reject(signal.reason)
        }, { once: true })
      })
      stage.publish()
      await mirrored
      expect(stage.snapshot.overlays).toEqual({ ...mmdOverlaysOff, feet: true })
      expect(lab.overlays).toEqual({ ...mmdOverlaysOff, feet: true })
      const before = lab.overlays
      const again = new Promise<void>((resolve, reject) => {
        const signal = AbortSignal.timeout(2000)
        const stop = watch(() => lab.snapshot, () => resolve(), { once: true, flush: 'sync' })
        signal.addEventListener('abort', () => {
          stop()
          reject(signal.reason)
        }, { once: true })
      })
      stage.publish()
      await again
      expect(lab.overlays).toBe(before)
    }
    finally {
      disposePinia(stagePinia)
      disposePinia(labPinia)
    }
  })

  it('exposes the overlay contract as a named eventa event', () => {
    expect(mmdOverlaySetEvent.id).toBe('eventa:event:mmd:motion-diagnostics:overlay:set')
  })

  it('routes measurement, director clock, and overlay commands without persisting them', () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    try {
      store.command({ type: 'command', name: 'startMeasurement' })
      store.recordFrame(0.02)
      store.command({ type: 'command', name: 'stopMeasurement' })
      store.command({ type: 'command', name: 'advanceDirectorClock', value: 60000 })
      store.command({ type: 'command', name: 'setOverlay', value: { ik: true } })
      store.publish()
      expect(store.snapshot.measurement).toMatchObject({ state: 'done', durationMs: 20, frames: 1, fps: 50 })
      expect(store.directorClockOffsetMs).toBe(60000)
      expect(store.overlays).toEqual({ ...mmdOverlaysOff, ik: true })
    }
    finally {
      disposePinia(pinia)
    }
  })

  it('folds reported readback timings into the next published measurement', () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000)
    try {
      store.reportReadback(0.5)
      store.publish()
      expect(store.snapshot.measurement).toBeNull()

      store.command({ type: 'command', name: 'startMeasurement' })
      store.reportReadback(1.5)
      store.recordFrame(1 / 60)
      store.publish()
      expect(store.snapshot.measurement).toMatchObject({ state: 'running', frames: 1, readbackMs: { meanMs: 1, maxMs: 1.5 } })
    }
    finally {
      now.mockRestore()
      disposePinia(pinia)
    }
  })

  it('accepts locomotion goal and home commands and rejects malformed ones with one warning', async () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    const peer = new BroadcastChannel('airi-stores-stage-ui-mmd-motion-diagnostics')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const applied = new Promise<void>((resolve, reject) => {
        const signal = AbortSignal.timeout(2000)
        const stop = watch(() => store.homeX, () => resolve(), { once: true, flush: 'sync' })
        signal.addEventListener('abort', () => {
          stop()
          reject(signal.reason)
        }, { once: true })
      })
      peer.postMessage({ type: 'command', name: 'requestGoal', value: { x: 4, pace: 'sprint' } })
      peer.postMessage({ type: 'command', name: 'requestGoal', value: { x: Number.NaN, pace: 'walk' } })
      peer.postMessage({ type: 'command', name: 'setHome', value: { x: '3' } })
      peer.postMessage({ type: 'command', name: 'setHome', value: { x: -3 } })
      await applied
      expect(store.goalRequest).toBeNull()
      expect(store.homeX).toBe(-3)
      expect(warning).toHaveBeenCalledTimes(1)

      store.command({ type: 'command', name: 'requestGoal', value: { x: 12, pace: 'walk' } })
      expect(store.goalRequest).toEqual({ seq: 1, x: 12, pace: 'walk' })
      store.command({ type: 'command', name: 'requestGoal', value: { x: 12, pace: 'stroll' } })
      expect(store.goalRequest).toEqual({ seq: 2, x: 12, pace: 'stroll' })
    }
    finally {
      warning.mockRestore()
      peer.close()
      disposePinia(pinia)
    }
  })

  it('accepts a roam mode of stay or roam and rejects any other value with one warning', () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.command({ type: 'command', name: 'setRoamMode', value: { mode: 'roam' } })
      expect(store.roamModeRequest).toEqual({ seq: 1, mode: 'roam' })
      for (const value of [{ mode: 'wander' }, { mode: 1 }, 'roam', null, {}])
        store.command({ type: 'command', name: 'setRoamMode', value } as unknown as MMDMotionCommand)
      expect(store.roamModeRequest).toEqual({ seq: 1, mode: 'roam' })
      expect(warning).toHaveBeenCalledTimes(1)
      store.command({ type: 'command', name: 'setRoamMode', value: { mode: 'stay' } })
      expect(store.roamModeRequest).toEqual({ seq: 2, mode: 'stay' })
    }
    finally {
      warning.mockRestore()
      disposePinia(pinia)
    }
  })

  it('queues a clip play with an optional loop and a stop from another window, and rejects malformed plays with one warning', async () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    const peer = new BroadcastChannel('airi-stores-stage-ui-mmd-motion-diagnostics')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const played = new Promise<void>((resolve, reject) => {
        const signal = AbortSignal.timeout(2000)
        const stop = watch(() => store.clipRequest, () => resolve(), { once: true, flush: 'sync' })
        signal.addEventListener('abort', () => {
          stop()
          reject(signal.reason)
        }, { once: true })
      })
      peer.postMessage({ type: 'command', name: 'playClip', value: { name: 'dance-long' } })
      await played
      expect(store.clipRequest).toEqual({ seq: 1, name: 'dance-long', loop: undefined })

      store.command({ type: 'command', name: 'playClip', value: { name: 'wave', loop: true } })
      expect(store.clipRequest).toEqual({ seq: 2, name: 'wave', loop: true })
      for (const value of [{ name: '' }, { name: 3 }, { name: 'wave', loop: 'yes' }, null, 'wave', undefined])
        store.command({ type: 'command', name: 'playClip', value } as unknown as MMDMotionCommand)
      expect(store.clipRequest).toEqual({ seq: 2, name: 'wave', loop: true })
      expect(warning).toHaveBeenCalledTimes(1)

      store.command({ type: 'command', name: 'stopClip' })
      expect(store.clipRequest).toEqual({ seq: 3, name: null, loop: undefined })
    }
    finally {
      warning.mockRestore()
      peer.close()
      disposePinia(pinia)
    }
  })

  it('accepts the arm rest hang angle between 0 and 90 degrees, clears it with null and rejects the rest with one warning', () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.command({ type: 'command', name: 'setDebugFlag', value: { flag: 'armRestHangDeg', value: 20 } })
      expect(store.debugFlags.armRestHangDeg).toBe(20)
      for (const value of [-1, 91, Number.NaN, '20', undefined])
        store.command({ type: 'command', name: 'setDebugFlag', value: { flag: 'armRestHangDeg', value } } as unknown as MMDMotionCommand)
      expect(store.debugFlags.armRestHangDeg).toBe(20)
      expect(warning).toHaveBeenCalledTimes(1)
      store.command({ type: 'command', name: 'setDebugFlag', value: { flag: 'armRestHangDeg', value: 90 } })
      expect(store.debugFlags.armRestHangDeg).toBe(90)
      store.command({ type: 'command', name: 'setDebugFlag', value: { flag: 'armRestHangDeg', value: null } })
      expect(store.debugFlags.armRestHangDeg).toBeNull()
    }
    finally {
      warning.mockRestore()
      disposePinia(pinia)
    }
  })
})
