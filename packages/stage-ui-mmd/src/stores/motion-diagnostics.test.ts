import type { MMDMotionCommand } from './motion-diagnostics'

import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'

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
          animation: { idle: null, currentAction: null, actionsStarted: 0 },
          characterPlacement: null,
          stageModel: null,
          measurement: null,
          locomotion: null,
          arms: null,
          overlays: { ik: false, colliders: false, feet: false, lookAt: false },
        },
      })
    }
    finally {
      peer.close()
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
      expect(stage.overlays).toEqual({ ik: false, colliders: true, feet: false, lookAt: false })
      expect(lab.overlays).toEqual({ ik: false, colliders: true, feet: false, lookAt: false })

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
      expect(stage.snapshot.overlays).toEqual({ ik: false, colliders: false, feet: true, lookAt: false })
      expect(lab.overlays).toEqual({ ik: false, colliders: false, feet: true, lookAt: false })
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
      expect(store.overlays).toEqual({ ik: true, colliders: false, feet: false, lookAt: false })
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
