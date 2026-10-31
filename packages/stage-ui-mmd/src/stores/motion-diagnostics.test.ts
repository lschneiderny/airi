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
          measurement: null,
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
      expect(store.debugFlags).toEqual({ disableLookAt: true, disableFootContact: false })
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
})
