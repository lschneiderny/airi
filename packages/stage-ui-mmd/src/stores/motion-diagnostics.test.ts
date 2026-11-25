import type { MMDMotionCommand, WalkPreviewStage } from './motion-diagnostics'

import { MotionTraceRecorder } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { STROLL_URGENCY, WALK_URGENCY } from '@proj-airi/motion-driver-humanoid/types'
import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'

import { MMDFrameMetrics, MMDFrameRing, MMDUsageTotals } from '../composables/mmd/frame-metrics'
import { mmdOverlaysOff } from '../composables/mmd/overlay-flags'
import { mmdOverlaySetEvent, useMMDMotionDiagnostics, walkPreviewGoalX } from './motion-diagnostics'

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
          performance: null,
        },
      })
    }
    finally {
      peer.close()
      disposePinia(pinia)
    }
  })

  it('publishes the body model summary with the arm measurement', () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    try {
      const bodyModel = { volumes: 12, garments: 2, pinchedGarments: 1, restAbductDeg: { left: 19, right: 21 }, restLimit: { left: null, right: 'garment' as const }, shrunkVolumes: 0, armCollisions: 'applied' as const }
      store.publish({ arms: { weight: 1, owned: { leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 }, penetration: { left: 0, right: 0 }, clothContact: { left: 0, right: 0 }, hangDeg: 70, handBelowHip: true, headPenetration: { left: 0, right: 0 }, correctionDeg: { left: 0, right: 0 }, bodyModel } })
      expect(store.snapshot.arms?.bodyModel).toEqual(bodyModel)
    }
    finally {
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

  it('accepts a performance layer switch and rejects malformed ones with one warning', async () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    const peer = new BroadcastChannel('airi-stores-stage-ui-mmd-motion-diagnostics')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const applied = new Promise<void>((resolve, reject) => {
        const signal = AbortSignal.timeout(2000)
        const stop = watch(() => store.performanceLayerRequest, () => resolve(), { once: true, flush: 'sync' })
        signal.addEventListener('abort', () => {
          stop()
          reject(signal.reason)
        }, { once: true })
      })
      peer.postMessage({ type: 'command', name: 'setPerformanceLayer', value: { layer: '', enabled: true } })
      peer.postMessage({ type: 'command', name: 'setPerformanceLayer', value: { layer: 'gesture', enabled: 'no' } })
      peer.postMessage({ type: 'command', name: 'setPerformanceLayer', value: { layer: 'gesture', enabled: false } })
      await applied
      expect(store.performanceLayerRequest).toEqual({ seq: 1, layer: 'gesture', enabled: false })
      expect(warning).toHaveBeenCalledTimes(1)
    }
    finally {
      warning.mockRestore()
      peer.close()
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
      peer.postMessage({ type: 'command', name: 'requestGoal', value: { x: 4, urgency: 1.5 } })
      peer.postMessage({ type: 'command', name: 'requestGoal', value: { x: Number.NaN, urgency: WALK_URGENCY } })
      peer.postMessage({ type: 'command', name: 'setHome', value: { x: '3' } })
      peer.postMessage({ type: 'command', name: 'setHome', value: { x: -3 } })
      await applied
      expect(store.goalRequest).toBeNull()
      expect(store.homeX).toBe(-3)
      expect(warning).toHaveBeenCalledTimes(1)

      store.command({ type: 'command', name: 'requestGoal', value: { x: 12, urgency: WALK_URGENCY } })
      expect(store.goalRequest).toEqual({ seq: 1, x: 12, urgency: WALK_URGENCY })
      store.command({ type: 'command', name: 'requestGoal', value: { x: 12, urgency: STROLL_URGENCY } })
      expect(store.goalRequest).toEqual({ seq: 2, x: 12, urgency: STROLL_URGENCY })
    }
    finally {
      warning.mockRestore()
      peer.close()
      disposePinia(pinia)
    }
  })

  it('accepts a walk preview baseline and rejects one outside the gait baseline schema with one warning', () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.command({ type: 'command', name: 'previewWalk', value: { baseline: { width: -0.6, sway: 0.6 } } })
      expect(store.walkPreview).toEqual({ seq: 1, baseline: { width: -0.6, sway: 0.6 } })
      store.command({ type: 'command', name: 'previewWalk', value: { baseline: { width: 2 } } })
      store.command(JSON.parse('{ "type": "command", "name": "previewWalk", "value": { "baseline": { "speed": 1 } } }') as MMDMotionCommand)
      store.command(JSON.parse('{ "type": "command", "name": "previewWalk" }') as MMDMotionCommand)
      expect(store.walkPreview).toEqual({ seq: 1, baseline: { width: -0.6, sway: 0.6 } })
      expect(warning).toHaveBeenCalledTimes(1)
    }
    finally {
      warning.mockRestore()
      disposePinia(pinia)
    }
  })

  it('walks a preview three leg lengths toward the side with more room, and only on a stage that can walk her', () => {
    const stage: WalkPreviewStage = {
      driver: 'natural',
      world: { ground: { minX: -10, maxX: 20 } },
      locomotion: { position: { x: 4 } },
      rig: { legLength: 2 },
    }
    const goal = (patch: Partial<WalkPreviewStage>) => walkPreviewGoalX({ ...stage, ...patch })
    expect(goal({})).toBe(10)
    expect(goal({ locomotion: { position: { x: 18 } } })).toBe(12)
    expect(goal({ rig: { legLength: 20 } })).toBe(20)
    expect(goal({ driver: 'classic' })).toBeNull()
    expect(goal({ world: null })).toBeNull()
    expect(goal({ locomotion: null })).toBeNull()
    expect(goal({ rig: null })).toBeNull()

    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    try {
      expect(store.previewWalk({ bounce: 0.8 })).toBe(false)
      expect(store.walkPreview).toBeNull()
      store.snapshot = { ...store.snapshot, ...stage } as typeof store.snapshot
      expect(store.previewWalk({ bounce: 0.8 })).toBe(true)
      expect(store.walkPreview).toEqual({ seq: 1, baseline: { bounce: 0.8 } })
      expect(store.goalRequest).toEqual({ seq: 1, x: 10, urgency: WALK_URGENCY })
    }
    finally {
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

  it('keeps frames recorded before a metrics swap in the next usage drain, and drains zeros afterwards', () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    try {
      store.recordFrame(0.016)
      store.recordFrame(0.016)
      store.setMetrics(new MMDFrameMetrics())
      store.recordFrame(0.03)

      const usage = new MMDUsageTotals()
      expect(store.drainUsage(usage)).toBe(true)
      expect(usage.frames).toBe(3)
      expect(usage.frameMaxMs).toBeCloseTo(30)

      expect(store.drainUsage(usage)).toBe(false)
      expect(usage.frames).toBe(0)
      expect(usage.frameHist.count).toBe(0)
    }
    finally {
      disposePinia(pinia)
    }
  })

  it('copies the frame ring of the current metrics', () => {
    const pinia = createPinia()
    const store = useMMDMotionDiagnostics(pinia)
    try {
      const ring = new MMDFrameRing()
      expect(store.copyFrameRing(ring)).toBe(false)
      const metrics = new MMDFrameMetrics()
      store.setMetrics(metrics)
      store.recordFrame(0.02)
      expect(store.copyFrameRing(ring)).toBe(true)
      expect(ring.count).toBe(1)
      expect(ring.intervalsMs[0]).toBeCloseTo(20)
    }
    finally {
      disposePinia(pinia)
    }
  })
})
